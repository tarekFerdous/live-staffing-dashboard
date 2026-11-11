import { BatchWriteCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SnapshotSchema, type Snapshot } from '@staffing/domain';
import { META_SK, shiftPk, SNAPSHOT_SK_FROM } from './keys';
import { seedItems, type SeedData } from './seed';

type Item = Record<string, unknown>;
type WriteRequest = { PutRequest?: { Item: Item }; DeleteRequest?: { Key: Item } };

export type ShiftStore = {
  /** META plus every worker row, read with a single Query. Null when the shift does not exist. */
  getSnapshot(shiftId: string): Promise<Snapshot | null>;
  /** Deletes the whole shift partition (event log included) and writes the seed items. */
  resetShift(seed: SeedData): Promise<void>;
};

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

  return {
    async getSnapshot(shiftId) {
      const items = await queryAll({
        KeyConditionExpression: 'PK = :pk AND SK >= :from',
        ExpressionAttributeValues: { ':pk': shiftPk(shiftId), ':from': SNAPSHOT_SK_FROM },
        ConsistentRead: true,
      });
      const meta = items.find((i) => i.SK === META_SK);
      if (!meta) return null;
      const workers = items
        .filter((i) => i.type === 'worker')
        .map((w) => ({
          id: w.id,
          name: w.name,
          participation: w.participation,
          attendance: w.attendance,
          invitedAt: w.invitedAt ?? null,
          respondedAt: w.respondedAt ?? null,
          checkedInAt: w.checkedInAt ?? null,
          checkedOutAt: w.checkedOutAt ?? null,
          version: w.version,
        }));
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
        workers,
        seq: meta.seq,
      });
    },

    async resetShift(seed) {
      const existing = await queryAll({
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': shiftPk(seed.shift.id) },
        ProjectionExpression: 'PK, SK',
        ConsistentRead: true,
      });
      await batchWrite(existing.map((Key) => ({ DeleteRequest: { Key } })));
      await batchWrite(seedItems(seed).map((Item) => ({ PutRequest: { Item } })));
    },
  };
}
