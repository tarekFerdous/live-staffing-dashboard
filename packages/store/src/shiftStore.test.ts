import { DeleteCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evtSk, META_SK, shiftPk } from './keys';
import { SEED } from './seed';
import { createShiftStore, isTransactionCanceled } from './shiftStore';
import { startTestDynamo, type TestDynamo } from './testing';

let dynamo: TestDynamo;
beforeAll(async () => {
  dynamo = await startTestDynamo();
}, 120_000);
afterAll(() => dynamo?.stop());

describe('isTransactionCanceled', () => {
  it("recognises the error from another copy of the SDK (Lambda's runtime), not only by class", () => {
    // A look-alike class, as a second copy of @aws-sdk/client-dynamodb would define it.
    class TransactionCanceledException extends Error {
      override name = 'TransactionCanceledException';
      CancellationReasons = [{ Code: 'TransactionConflict' }];
    }
    expect(isTransactionCanceled(new TransactionCanceledException('conflict'))).toBe(true);
    expect(isTransactionCanceled(new Error('boom'))).toBe(false);
    expect(isTransactionCanceled({ name: 'TransactionCanceledException' })).toBe(false);
  });
});

describe('transaction conflicts (DynamoDB Local never produces them, the real service does)', () => {
  /** Lets `failures` calls of `command` fail with a TransactionConflict, as a look-alike SDK copy would. */
  function conflicting(doc: DynamoDBDocumentClient, command: string, failures: number) {
    class TransactionCanceledException extends Error {
      override name = 'TransactionCanceledException';
      CancellationReasons = [{ Code: 'TransactionConflict' }, { Code: 'None' }];
    }
    let left = failures;
    return {
      send: (cmd: { constructor: { name: string } }) => {
        if (cmd.constructor.name === command && left-- > 0) {
          return Promise.reject(new TransactionCanceledException('Transaction is ongoing for the item'));
        }
        return doc.send(cmd as never);
      },
    } as unknown as DynamoDBDocumentClient;
  }

  it('retries when the read conflicts with another action still writing', async () => {
    const { doc, tableName } = await dynamo.newTable();
    await createShiftStore(doc, tableName).resetShift(SEED);
    const store = createShiftStore(conflicting(doc, 'TransactGetCommand', 2), tableName);
    expect(await store.applyAction(SEED.shift.id, 'amara', 'invite')).toMatchObject({
      kind: 'applied',
      seq: 1,
    });
  });

  it('retries when the write conflicts', async () => {
    const { doc, tableName } = await dynamo.newTable();
    await createShiftStore(doc, tableName).resetShift(SEED);
    const store = createShiftStore(conflicting(doc, 'TransactWriteCommand', 1), tableName);
    expect(await store.applyAction(SEED.shift.id, 'amara', 'invite')).toMatchObject({
      kind: 'applied',
      seq: 1,
    });
  });

  it('answers busy, not an error, when conflicts outlast the retries', async () => {
    const { doc, tableName } = await dynamo.newTable();
    await createShiftStore(doc, tableName).resetShift(SEED);
    const store = createShiftStore(conflicting(doc, 'TransactGetCommand', 99), tableName);
    expect(await store.applyAction(SEED.shift.id, 'amara', 'invite')).toEqual({ kind: 'busy' });
  });
});

describe('shift store against DynamoDB Local', () => {
  it('reset writes META with seq 0 / acceptedCount 0 and three Uninvited, Not started workers', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);

    const snap = await store.getSnapshot(SEED.shift.id);
    expect(snap).not.toBeNull();
    expect(snap!.seq).toBe(0);
    expect(snap!.epoch).toBe(1);
    expect(snap!.shift).toEqual({ ...SEED.shift, acceptedCount: 0 });
    expect(snap!.workers).toHaveLength(3);
    for (const w of snap!.workers) {
      expect(w).toMatchObject({
        participation: 'uninvited',
        attendance: 'not_started',
        invitedAt: null,
        respondedAt: null,
        checkedInAt: null,
        checkedOutAt: null,
        version: 0,
      });
    }
  });

  it('resetting twice gives an identical snapshot, and reset wipes later changes and events', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);
    const first = await store.getSnapshot(SEED.shift.id);

    // Simulate later activity: a changed worker row and an event log entry.
    const pk = shiftPk(SEED.shift.id);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { PK: pk, SK: 'WORKER#amara', type: 'worker', ...first!.workers[0], participation: 'invited' },
      }),
    );
    await doc.send(new PutCommand({ TableName: tableName, Item: { PK: pk, SK: evtSk(1), seq: 1 } }));

    await store.resetShift(SEED);
    // Identical except that each reset bumps the epoch.
    expect(await store.getSnapshot(SEED.shift.id)).toEqual({ ...first, epoch: first!.epoch + 1 });
    expect(await store.listEvents(SEED.shift.id)).toEqual([]);
  });

  it('starts the epoch at 1 on an empty table and bumps it by 1 on every reset', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    expect(await store.getEpoch(SEED.shift.id)).toBeNull();
    expect(await store.resetShift(SEED)).toBe(1);
    expect((await store.getSnapshot(SEED.shift.id))!.epoch).toBe(1);
    expect(await store.resetShift(SEED)).toBe(2);
    expect(await store.resetShift(SEED)).toBe(3);
    expect(await store.getEpoch(SEED.shift.id)).toBe(3);
  });

  it('carries on from a META written before epochs existed (epoch 0)', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);
    const pk = shiftPk(SEED.shift.id);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { PK: pk, SK: META_SK, type: 'shift', ...SEED.shift, seq: 0, acceptedCount: 0 },
      }),
    );
    expect((await store.getSnapshot(SEED.shift.id))!.epoch).toBe(0);
    expect(await store.resetShift(SEED)).toBe(1);
  });

  it('answers SHIFT_NOT_FOUND for an action while META is gone mid-reset, and changes nothing', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);
    // The first step of a reset: META deleted, workers still there.
    await doc.send(
      new DeleteCommand({ TableName: tableName, Key: { PK: shiftPk(SEED.shift.id), SK: META_SK } }),
    );

    const outcome = await store.applyAction(SEED.shift.id, 'amara', 'invite');
    expect(outcome).toMatchObject({ kind: 'not_found', code: 'SHIFT_NOT_FOUND' });
    expect(await store.listEvents(SEED.shift.id)).toEqual([]);
  });

  it('snapshot excludes event log items', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { PK: shiftPk(SEED.shift.id), SK: evtSk(1), type: 'event', seq: 1 },
      }),
    );
    const snap = await store.getSnapshot(SEED.shift.id);
    expect(snap!.workers.map((w) => w.id).sort()).toEqual(['amara', 'liam', 'sofia']);
  });

  it('returns null for an unknown shift', async () => {
    const { doc, tableName } = await dynamo.newTable();
    expect(await createShiftStore(doc, tableName).getSnapshot('nope')).toBeNull();
  });

  it('creates tables with provisioned 5/5 capacity and a NEW_IMAGE stream', async () => {
    const { client, tableName } = await dynamo.newTable();
    const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    expect(Table?.ProvisionedThroughput).toMatchObject({ ReadCapacityUnits: 5, WriteCapacityUnits: 5 });
    expect(Table?.StreamSpecification).toEqual({ StreamEnabled: true, StreamViewType: 'NEW_IMAGE' });
  });
});
