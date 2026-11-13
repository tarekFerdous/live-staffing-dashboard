import type { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  applyAction,
  SnapshotSchema,
  TRANSITIONS,
  WorkerSchema,
  type Action,
  type RejectionCode,
  type Snapshot,
  type Worker,
} from '@staffing/domain';
import { EVT_PREFIX, evtSk, META_SK, shiftPk, SNAPSHOT_SK_FROM, workerSk } from './keys';
import { seedMeta, seedWorkers, type SeedData } from './seed';

type Item = Record<string, unknown>;
type WriteRequest = { PutRequest?: { Item: Item }; DeleteRequest?: { Key: Item } };

/** One entry in the append-only event log (`EVT#<seq>`). */
export type ShiftEvent = {
  seq: number;
  type: Action;
  workerId: string;
  actor: 'manager' | 'worker';
  /** The complete worker row after the change. */
  row: Worker;
  at: string;
  /** The shift's epoch when the change was made (absent on events from before epochs). */
  epoch?: number;
};

export type ActionOutcome =
  | { kind: 'applied'; worker: Worker; seq: number }
  | { kind: 'already'; worker: Worker }
  | { kind: 'rejected'; code: RejectionCode; message: string; current: Worker }
  | { kind: 'not_found'; code: 'SHIFT_NOT_FOUND' | 'WORKER_NOT_FOUND'; message: string }
  | { kind: 'busy' };

export type ApplyOptions = { expectedVersion?: number; now?: () => string };

export type ShiftStore = {
  /** META plus every worker row, read with a single Query. Null when the shift does not exist. */
  getSnapshot(shiftId: string): Promise<Snapshot | null>;
  /**
   * Puts the shift back to the seed and bumps its epoch (0 → 1 when there was no shift).
   * Returns the new epoch. Not one transaction (the log can outgrow the item limit), so the
   * order is what keeps it safe: META goes first, so an action during the reset fails with
   * SHIFT_NOT_FOUND instead of half-applying; META comes back last, and that write is the
   * moment the reset takes effect (and what the stream turns into a live reset message).
   */
  resetShift(seed: SeedData): Promise<number>;
  /** The shift's current epoch, or null when the shift does not exist. */
  getEpoch(shiftId: string): Promise<number | null>;
  /**
   * Applies one action atomically: the worker row, META `seq` (and `acceptedCount`)
   * and a new `EVT#<seq>` item are written in one conditional transaction.
   */
  applyAction(shiftId: string, workerId: string, action: Action, opts?: ApplyOptions): Promise<ActionOutcome>;
  /** Events with seq > afterSeq, oldest first; at most `limit` of them when given. */
  listEvents(shiftId: string, afterSeq?: number, limit?: number): Promise<ShiftEvent[]>;
  /**
   * The safety net's read (#91): events with seq > afterSeq, oldest first and at most `limit`,
   * plus the shift's current epoch, from one Query over `EVT#<afterSeq+1> … META` (`EVT#` sorts
   * before `META`). `hasMore` says more events exist than were returned. `epoch` is null when
   * the shift does not exist. `consistent: false` reads eventually consistently, at half the cost.
   */
  readEventsAndEpoch(
    shiftId: string,
    afterSeq: number,
    limit: number,
    opts?: { consistent?: boolean },
  ): Promise<{ events: ShiftEvent[]; hasMore: boolean; epoch: number | null }>;
};

/**
 * Matched by name, not `instanceof`: in Lambda the error comes from the runtime's own copy of the
 * AWS SDK (a nested `node_modules`), so class identity is not something to rely on.
 */
export function isTransactionCanceled(err: unknown): err is TransactionCanceledException {
  return err instanceof Error && err.name === 'TransactionCanceledException';
}

/** Optimistic retries when another write to the same shift got in first. */
const MAX_RETRIES = 3;
const backoff = (attempt: number) =>
  new Promise((r) => setTimeout(r, 15 * 2 ** attempt + Math.random() * 25 * (attempt + 1)));

function toWorker(item: Item): Worker {
  return WorkerSchema.parse({
    id: item.id,
    name: item.name,
    role: item.role,
    phone: item.phone,
    email: item.email,
    address: item.address,
    participation: item.participation,
    attendance: item.attendance,
    invitedAt: item.invitedAt ?? null,
    respondedAt: item.respondedAt ?? null,
    checkedInAt: item.checkedInAt ?? null,
    checkedOutAt: item.checkedOutAt ?? null,
    version: item.version,
  });
}

export function createShiftStore(doc: DynamoDBDocumentClient, tableName: string): ShiftStore {
  async function queryAll(input: Omit<ConstructorParameters<typeof QueryCommand>[0], 'TableName'>) {
    const items: Item[] = [];
    let ExclusiveStartKey: Item | undefined;
    do {
      const res = await doc.send(new QueryCommand({ ...input, TableName: tableName, ExclusiveStartKey }));
      items.push(...((res.Items ?? []) as Item[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async function batchWrite(requests: WriteRequest[]) {
    for (let i = 0; i < requests.length; i += 25) await batchChunk(requests.slice(i, i + 25));
  }

  async function batchChunk(requests: WriteRequest[]) {
    let pending = requests;
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt > 8) throw new Error('BatchWrite kept returning unprocessed items');
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const res = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
      pending = (res.UnprocessedItems?.[tableName] ?? []) as WriteRequest[];
    }
  }

  async function getEpoch(shiftId: string): Promise<number | null> {
    const res = await doc.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: shiftPk(shiftId), SK: META_SK },
        ProjectionExpression: 'epoch',
        ConsistentRead: true,
      }),
    );
    if (!res.Item) return null;
    return (res.Item.epoch as number | undefined) ?? 0; // shifts seeded before epochs existed
  }

  /** One attempt: read META + worker, decide with the domain rules, write everything in one transaction. */
  async function attempt(
    shiftId: string,
    workerId: string,
    action: Action,
    opts: ApplyOptions,
  ): Promise<ActionOutcome | 'retry'> {
    const pk = shiftPk(shiftId);
    let read;
    try {
      read = await doc.send(
        new TransactGetCommand({
          TransactItems: [
            { Get: { TableName: tableName, Key: { PK: pk, SK: META_SK } } },
            { Get: { TableName: tableName, Key: { PK: pk, SK: workerSk(workerId) } } },
          ],
        }),
      );
    } catch (err) {
      // The read conflicts with another action's transaction still writing META: read again.
      if (isTransactionCanceled(err)) return 'retry';
      throw err;
    }
    const meta = read.Responses?.[0]?.Item;
    const workerItem = read.Responses?.[1]?.Item;
    if (!meta)
      return { kind: 'not_found', code: 'SHIFT_NOT_FOUND', message: `Shift "${shiftId}" was not found.` };
    if (!workerItem) {
      return {
        kind: 'not_found',
        code: 'WORKER_NOT_FOUND',
        message: `Worker "${workerId}" is not on this shift.`,
      };
    }

    const worker = toWorker(workerItem);
    const seq = meta.seq as number;
    const now = (opts.now ?? (() => new Date().toISOString()))();
    const result = applyAction(worker, action, {
      now,
      acceptedCount: meta.acceptedCount as number,
      required: meta.required as number,
      expectedVersion: opts.expectedVersion,
    });
    if (result.kind !== 'applied') return result;

    const next = result.worker;
    const t = TRANSITIONS[action];
    const nextSeq = seq + 1;

    // Worker row: only from an allowed state, and only from the version we read.
    const fromStates = t.from
      .map((_, i) => `(participation = :fp${i} AND attendance = :fa${i})`)
      .join(' OR ');
    const values: Item = {
      ':p': next.participation,
      ':a': next.attendance,
      ':v': next.version,
      ':rv': worker.version,
    };
    t.from.forEach((f, i) => {
      values[`:fp${i}`] = f.participation;
      values[`:fa${i}`] = f.attendance;
    });
    let set = 'participation = :p, attendance = :a, version = :v';
    if (t.sets) {
      // Timestamps are only ever filled in; no write overwrites one.
      values[':ts'] = next[t.sets];
      set += ', #ts = if_not_exists(#ts, :ts)';
    }

    // META: seq must still be what we read; accept also needs a free place.
    let metaUpdate = 'SET seq = :next';
    let metaCond = 'seq = :read';
    const metaValues: Item = { ':next': nextSeq, ':read': seq };
    if (result.acceptedDelta !== 0) {
      metaUpdate += ' ADD acceptedCount :delta';
      metaValues[':delta'] = result.acceptedDelta;
    }
    if (t.needsCapacity) metaCond += ' AND acceptedCount < #required';

    const event: ShiftEvent = {
      seq: nextSeq,
      type: action,
      workerId,
      actor: t.actor,
      row: next,
      at: now,
      epoch: (meta.epoch as number | undefined) ?? 0,
    };

    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName,
                Key: { PK: pk, SK: workerSk(workerId) },
                UpdateExpression: `SET ${set}`,
                // DynamoDB rejects redundant parentheses, so only group several from-states.
                ConditionExpression: `${t.from.length > 1 ? `(${fromStates})` : fromStates} AND version = :rv`,
                ExpressionAttributeValues: values,
                ...(t.sets && { ExpressionAttributeNames: { '#ts': t.sets } }),
                ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
              },
            },
            {
              Update: {
                TableName: tableName,
                Key: { PK: pk, SK: META_SK },
                UpdateExpression: metaUpdate,
                ConditionExpression: metaCond,
                ExpressionAttributeValues: metaValues,
                ...(t.needsCapacity && { ExpressionAttributeNames: { '#required': 'required' } }),
                ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: { PK: pk, SK: evtSk(nextSeq), ...event },
                ConditionExpression: 'attribute_not_exists(SK)',
              },
            },
          ],
        }),
      );
      return { kind: 'applied', worker: next, seq: nextSeq };
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
      const [, metaReason] = err.CancellationReasons ?? [];
      // seq unchanged but the META condition failed: the only other clause is capacity.
      if (metaReason?.Code === 'ConditionalCheckFailed' && metaReason.Item) {
        if (unmarshall(metaReason.Item).seq === seq) {
          return { kind: 'rejected', code: 'SHIFT_FULL', message: 'No places left', current: worker };
        }
      }
      // Someone else wrote first (worker row, seq, or a transaction conflict):
      // re-read and decide again. A repeat of a successful action then resolves to 'already'.
      return 'retry';
    }
  }

  return {
    async getSnapshot(shiftId) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk AND SK >= :from',
        ExpressionAttributeValues: { ':pk': shiftPk(shiftId), ':from': SNAPSHOT_SK_FROM },
        ConsistentRead: true,
      });
      const meta = items.find((i) => i.SK === META_SK);
      if (!meta) return null;
      return SnapshotSchema.parse({
        shift: {
          id: meta.id,
          title: meta.title,
          location: meta.location,
          startsAt: meta.startsAt,
          endsAt: meta.endsAt,
          timezone: meta.timezone,
          required: meta.required,
          acceptedCount: meta.acceptedCount,
        },
        workers: items.filter((i) => i.type === 'worker').map(toWorker),
        seq: meta.seq,
        epoch: meta.epoch ?? 0,
      });
    },

    getEpoch,

    async resetShift(seed) {
      const pk = shiftPk(seed.shift.id);
      const epoch = ((await getEpoch(seed.shift.id)) ?? 0) + 1;
      // 1. META first: from here on every action answers SHIFT_NOT_FOUND.
      await doc.send(new DeleteCommand({ TableName: tableName, Key: { PK: pk, SK: META_SK } }));
      // 2. Workers and the event log.
      const rest = await queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ProjectionExpression: 'PK, SK',
        ConsistentRead: true,
      });
      await batchWrite(rest.map((Key) => ({ DeleteRequest: { Key } })));
      // 3. The seed's workers, then 4. META with the new epoch: the reset takes effect here.
      await batchWrite(seedWorkers(seed).map((Item) => ({ PutRequest: { Item } })));
      await doc.send(new PutCommand({ TableName: tableName, Item: seedMeta(seed, epoch) }));
      return epoch;
    },

    async applyAction(shiftId, workerId, action, opts = {}) {
      for (let i = 0; i <= MAX_RETRIES; i++) {
        if (i > 0) await backoff(i);
        const outcome = await attempt(shiftId, workerId, action, opts);
        if (outcome !== 'retry') return outcome;
      }
      return { kind: 'busy' };
    },

    async listEvents(shiftId, afterSeq = 0, limit) {
      const input = {
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': shiftPk(shiftId),
          ':from': evtSk(afterSeq + 1),
          ':to': `${EVT_PREFIX}~`,
        },
        ConsistentRead: true,
      };
      // Events are small, so one page of `limit` items stays far below the 1 MB Query page size.
      const items =
        limit === undefined
          ? await queryAll(input)
          : (((await doc.send(new QueryCommand({ ...input, TableName: tableName, Limit: limit }))).Items ??
              []) as Item[]);
      return items.map(toEvent);
    },

    async readEventsAndEpoch(shiftId, afterSeq, limit, { consistent = true } = {}) {
      // Events, then META as the last item. Room for one event more than `limit` (to tell whether
      // more exist) and for META: more events than that is a long gap, rare, and costs a second read.
      const res = await doc.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :meta',
          ExpressionAttributeValues: {
            ':pk': shiftPk(shiftId),
            ':from': evtSk(afterSeq + 1),
            ':meta': META_SK,
          },
          ConsistentRead: consistent,
          Limit: limit + 2,
        }),
      );
      const items = (res.Items ?? []) as Item[];
      const meta = items.find((i) => i.SK === META_SK);
      const events = items.filter((i) => i.SK !== META_SK).map(toEvent);
      const epoch = meta
        ? ((meta.epoch as number | undefined) ?? 0)
        : res.LastEvaluatedKey
          ? await getEpoch(shiftId)
          : null;
      return { events: events.slice(0, limit), hasMore: events.length > limit, epoch };
    },
  };
}

function toEvent(i: Item): ShiftEvent {
  return {
    seq: i.seq as number,
    type: i.type as Action,
    workerId: i.workerId as string,
    actor: i.actor as ShiftEvent['actor'],
    row: toWorker(i.row as Item),
    at: i.at as string,
    ...(typeof i.epoch === 'number' && { epoch: i.epoch }),
  };
}
