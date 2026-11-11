import { DemoResetResponseSchema, EventsPageSchema } from '@staffing/domain';
import { createShiftStore, SEED, type ShiftStore } from '@staffing/store';
import { startTestDynamo, type TestDynamo } from '@staffing/store/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDemoResetHandler } from './demoReset';
import { makeGetEventsHandler } from './getEvents';
import { makeGetShiftHandler } from './getShift';
import type { HttpEvent } from './http';
import { createLocalServer } from './local/adapter';

const post = { body: undefined } as unknown as HttpEvent;
const getShift = { pathParameters: { shiftId: SEED.shift.id } } as unknown as HttpEvent;

let dynamo: TestDynamo;
let store: ShiftStore;
beforeAll(async () => {
  dynamo = await startTestDynamo();
  const { doc, tableName } = await dynamo.newTable('reset');
  store = createShiftStore(doc, tableName);
  await store.resetShift(SEED); // epoch 1
}, 180_000);
afterAll(() => dynamo?.stop());

const reset = () => makeDemoResetHandler({ store, seeds: [SEED] })(post);

describe('POST /api/demo/reset', () => {
  it('puts the seeded snapshot back after actions and returns the new epoch', async () => {
    await store.applyAction(SEED.shift.id, 'amara', 'invite');
    await store.applyAction(SEED.shift.id, 'amara', 'accept');

    const res = await reset();
    expect(res.statusCode).toBe(200);
    const body = DemoResetResponseSchema.parse(JSON.parse(res.body));
    expect(body).toEqual({ shifts: [{ id: SEED.shift.id, epoch: 2 }] });

    const snap = JSON.parse((await makeGetShiftHandler(store)(getShift)).body);
    expect(snap.seq).toBe(0);
    expect(snap.epoch).toBe(2);
    expect(snap.shift.acceptedCount).toBe(0);
    expect(snap.workers.every((w: { participation: string }) => w.participation === 'uninvited')).toBe(true);
  });

  it('works repeatedly, bumping the epoch each time', async () => {
    const before = (await store.getEpoch(SEED.shift.id))!;
    for (let i = 1; i <= 3; i++) {
      const body = JSON.parse((await reset()).body);
      expect(body.shifts[0].epoch).toBe(before + i);
    }
  });

  it('the catch-up response carries the current epoch', async () => {
    const epoch = (await store.getEpoch(SEED.shift.id))!;
    const res = await makeGetEventsHandler(store)({
      pathParameters: { shiftId: SEED.shift.id },
    } as unknown as HttpEvent);
    expect(EventsPageSchema.parse(JSON.parse(res.body))).toEqual({ events: [], hasMore: false, epoch });
  });

  it('is served by the local HTTP adapter through the same handler', async () => {
    const server = createLocalServer([
      { method: 'POST', path: '/api/demo/reset', handler: makeDemoResetHandler({ store, seeds: [SEED] }) },
    ]);
    await new Promise<void>((r) => server.listen(0, r));
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://localhost:${port}/api/demo/reset`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(DemoResetResponseSchema.parse(await res.json()).shifts[0]!.id).toBe(SEED.shift.id);
    } finally {
      server.close();
    }
  });
});
