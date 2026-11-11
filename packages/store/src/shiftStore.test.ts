import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evtSk, shiftPk } from './keys';
import { SEED } from './seed';
import { createShiftStore } from './shiftStore';
import { startTestDynamo, type TestDynamo } from './testing';

let dynamo: TestDynamo;
beforeAll(async () => {
  dynamo = await startTestDynamo();
}, 120_000);
afterAll(() => dynamo?.stop());

describe('shift store against DynamoDB Local', () => {
  it('reset writes META with seq 0 / acceptedCount 0 and three Uninvited, Not started workers', async () => {
    const { doc, tableName } = await dynamo.newTable();
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);

    const snap = await store.getSnapshot(SEED.shift.id);
    expect(snap).not.toBeNull();
    expect(snap!.seq).toBe(0);
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
    expect(await store.getSnapshot(SEED.shift.id)).toEqual(first);
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
