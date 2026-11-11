import type { AddressInfo } from 'node:net';
import { createShiftStore, SEED, type ShiftStore } from '@staffing/store';
import { startTestDynamo, type TestDynamo } from '@staffing/store/testing';
import { SnapshotSchema } from '@staffing/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeGetShiftHandler } from './getShift';
import type { HttpEvent } from './http';
import { createLocalServer } from './local/adapter';

const get = (shiftId?: string) =>
  ({ pathParameters: shiftId === undefined ? undefined : { shiftId } }) as unknown as HttpEvent;

let dynamo: TestDynamo;
let store: ShiftStore;
let queryCount = 0;

beforeAll(async () => {
  dynamo = await startTestDynamo();
  const { doc, tableName } = await dynamo.newTable('read');
  doc.middlewareStack.add(
    (next, ctx) => (args) => {
      if (ctx.commandName === 'QueryCommand') queryCount++;
      return next(args);
    },
    { step: 'initialize' },
  );
  store = createShiftStore(doc, tableName);
  await store.resetShift(SEED);
}, 180_000);
afterAll(() => dynamo?.stop());

describe('GET /api/shifts/{shiftId}', () => {
  it('returns the seeded snapshot in a single Query', async () => {
    queryCount = 0;
    const res = await makeGetShiftHandler(store)(get(SEED.shift.id));
    expect(res.statusCode).toBe(200);
    expect(queryCount).toBe(1);
    const body = SnapshotSchema.parse(JSON.parse(res.body));
    expect(body.seq).toBe(0);
    expect(body.shift.title).toBe(SEED.shift.title);
    expect(body.workers.map((w) => [w.name, w.participation, w.attendance])).toEqual(
      expect.arrayContaining([
        ['Amara Okafor', 'uninvited', 'not_started'],
        ['Liam Chen', 'uninvited', 'not_started'],
        ['Sofia Rossi', 'uninvited', 'not_started'],
      ]),
    );
    expect(Object.keys(body)).not.toContain('counts');
    // Profile details come with the snapshot.
    for (const seeded of SEED.workers) {
      expect(body.workers.find((w) => w.id === seeded.id)).toMatchObject({
        role: 'Worker',
        phone: seeded.phone,
        email: seeded.email,
        address: seeded.address,
      });
    }
  });

  it('returns 404 with a readable message for an unknown shift', async () => {
    const res = await makeGetShiftHandler(store)(get('does-not-exist'));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      code: 'SHIFT_NOT_FOUND',
      message: 'Shift "does-not-exist" was not found.',
    });
  });

  it('returns 500 with a readable message when the store fails', async () => {
    const broken = { ...store, getSnapshot: () => Promise.reject(new Error('boom')) } satisfies ShiftStore;
    const res = await makeGetShiftHandler(broken)(get('x'));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).message).toMatch(/try again/);
  });

  it('is served by the local HTTP adapter through the same handler', async () => {
    const server = createLocalServer([
      { method: 'GET', path: '/api/shifts/{shiftId}', handler: makeGetShiftHandler(store) },
    ]);
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/api/shifts/${SEED.shift.id}`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { shift: { id: string } }).shift.id).toBe(SEED.shift.id);
      expect((await fetch(`${base}/api/shifts/nope`)).status).toBe(404);
      expect((await fetch(`${base}/api/elsewhere`)).status).toBe(404);
    } finally {
      server.close();
    }
  });
});
