import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventsPageSchema, MAX_EVENTS_PAGE } from '@staffing/domain';
import { createShiftStore, evtSk, META_SK, SEED, shiftPk, type ShiftStore } from '@staffing/store';
import { startTestDynamo, type TestDynamo, type TestTables } from '@staffing/store/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeGetEventsHandler } from './getEvents';
import type { HttpEvent } from './http';

const get = (shiftId: string, after?: string) =>
  ({
    pathParameters: { shiftId },
    queryStringParameters: after === undefined ? undefined : { after },
  }) as unknown as HttpEvent;

let dynamo: TestDynamo;
let tables: TestTables;
let store: ShiftStore;

beforeAll(async () => {
  dynamo = await startTestDynamo();
  tables = await dynamo.newTable('events');
  store = createShiftStore(tables.doc, tables.tableName);
  await store.resetShift(SEED);
  // seq 1..4
  for (const [worker, action] of [
    ['amara', 'invite'],
    ['amara', 'accept'],
    ['amara', 'check_in'],
    ['liam', 'invite'],
  ] as const) {
    expect((await store.applyAction(SEED.shift.id, worker, action)).kind).toBe('applied');
  }
}, 180_000);
afterAll(() => dynamo?.stop());

async function page(shiftId: string, after?: string) {
  const res = await makeGetEventsHandler(store)(get(shiftId, after));
  expect(res.statusCode).toBe(200);
  return EventsPageSchema.parse(JSON.parse(res.body));
}

describe('GET /api/shifts/{shiftId}/events', () => {
  it('returns every event in seq order when after is missing or 0', async () => {
    for (const after of [undefined, '0']) {
      const { events, hasMore } = await page(SEED.shift.id, after);
      expect(events.map((e) => [e.seq, e.type, e.workerId])).toEqual([
        [1, 'invite', 'amara'],
        [2, 'accept', 'amara'],
        [3, 'check_in', 'amara'],
        [4, 'invite', 'liam'],
      ]);
      expect(hasMore).toBe(false);
      // Each event carries the full row after the change.
      expect(events[2]!.row).toMatchObject({
        id: 'amara',
        participation: 'accepted',
        attendance: 'checked_in',
      });
    }
  });

  it('returns only the events after the given seq', async () => {
    const { events } = await page(SEED.shift.id, '2');
    expect(events.map((e) => e.seq)).toEqual([3, 4]);
    expect((await page(SEED.shift.id, '4')).events).toEqual([]);
    expect((await page(SEED.shift.id, '99')).events).toEqual([]);
  });

  it('rejects an after that is not a whole number', async () => {
    for (const after of ['-1', 'abc', '1.5', '']) {
      const res = await makeGetEventsHandler(store)(get(SEED.shift.id, after));
      expect(res.statusCode, after).toBe(422);
      expect(JSON.parse(res.body).code).toBe('VALIDATION_FAILED');
    }
  });

  it(`returns at most ${MAX_EVENTS_PAGE} events and flags that more exist`, async () => {
    const shiftId = 'big-log';
    const at = '2026-12-12T22:00:00.000Z';
    const row = {
      id: 'amara',
      name: 'Amara Okafor',
      participation: 'invited',
      attendance: 'not_started',
      invitedAt: at,
      respondedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      role: 'Worker',
      phone: '+1 416-555-0142',
      email: 'amara.okafor@example.com',
      address: '88 Bathurst St, Toronto, ON M5V 2P5',
      version: 1,
    };
    const meta = {
      PK: shiftPk(shiftId),
      SK: META_SK,
      ...SEED.shift,
      id: shiftId,
      seq: 205,
      acceptedCount: 0,
      epoch: 7,
    };
    const events = Array.from({ length: MAX_EVENTS_PAGE + 5 }, (_, i) => ({
      PK: shiftPk(shiftId),
      SK: evtSk(i + 1),
      seq: i + 1,
      type: 'invite',
      workerId: 'amara',
      actor: 'manager',
      row,
      at,
    }));
    const items = [meta, ...events];
    for (let i = 0; i < items.length; i += 25) {
      await tables.doc.send(
        new BatchWriteCommand({
          RequestItems: {
            [tables.tableName]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
          },
        }),
      );
    }

    const first = await page(shiftId, '0');
    expect(first.events).toHaveLength(MAX_EVENTS_PAGE);
    expect(first.events[0]!.seq).toBe(1);
    expect(first.events.at(-1)!.seq).toBe(MAX_EVENTS_PAGE);
    expect(first.hasMore).toBe(true);

    const rest = await page(shiftId, String(MAX_EVENTS_PAGE));
    expect(rest.events.map((e) => e.seq)).toEqual([201, 202, 203, 204, 205]);
    expect(rest.hasMore).toBe(false);
    expect(rest.epoch).toBe(7);
  });

  it('carries the current epoch and answers 404 for an unknown shift', async () => {
    expect((await page(SEED.shift.id)).epoch).toBe(await store.getEpoch(SEED.shift.id));
    const res = await makeGetEventsHandler(store)(get('no-such-shift'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).code).toBe('SHIFT_NOT_FOUND');
  });

  it('returns 500 with a readable message when the store fails', async () => {
    const broken = { ...store, listEvents: () => Promise.reject(new Error('boom')) } satisfies ShiftStore;
    const res = await makeGetEventsHandler(broken)(get('x'));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toMatch(/try again/);
  });
});
