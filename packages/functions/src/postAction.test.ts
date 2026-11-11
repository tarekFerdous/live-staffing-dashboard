import { randomUUID } from 'node:crypto';
import { deriveCounts, type Action, type Worker } from '@staffing/domain';
import { createShiftStore, SEED, type SeedData, type ShiftStore } from '@staffing/store';
import { startTestDynamo, type TestDynamo } from '@staffing/store/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HttpEvent, HttpResult } from './http';
import { makeActionHandler } from './postAction';

let dynamo: TestDynamo;
beforeAll(async () => {
  dynamo = await startTestDynamo();
}, 180_000);
afterAll(() => dynamo?.stop());

const SHIFT = SEED.shift.id;

/** A fresh shift (own tables) and its action endpoint. */
async function setup(seed: SeedData = SEED) {
  const { client, doc, tableName, idempotencyTableName } = await dynamo.newTable('act');
  const store = createShiftStore(doc, tableName);
  await store.resetShift(seed);
  const handler = makeActionHandler({ store, idempotency: { client, tableName: idempotencyTableName } });

  async function post(
    workerId: string,
    body: unknown,
    opts: { key?: string | null; raw?: string } = {},
  ): Promise<HttpResult & { json: Record<string, unknown> }> {
    const key = opts.key === undefined ? randomUUID() : opts.key;
    const rawPath = `/api/shifts/${seed.shift.id}/workers/${workerId}/actions`;
    const event = {
      rawPath,
      headers: key === null ? {} : { 'idempotency-key': key },
      pathParameters: { shiftId: seed.shift.id, workerId },
      body: opts.raw ?? JSON.stringify(body),
    } as unknown as HttpEvent;
    const res = await handler(event);
    return { ...res, json: JSON.parse(res.body) };
  }
  const act = (workerId: string, action: Action, extra: Record<string, unknown> = {}, key?: string) =>
    post(workerId, { action, ...extra }, { key });
  return { store, post, act };
}

const worker = (res: { json: Record<string, unknown> }) => res.json.worker as Worker;

async function expectLog(store: ShiftStore, types: Action[]) {
  const events = await store.listEvents(SHIFT);
  expect(events.map((e) => e.type)).toEqual(types);
  expect(events.map((e) => e.seq)).toEqual(types.map((_, i) => i + 1)); // gap-free
  const snap = await store.getSnapshot(SHIFT);
  expect(snap!.seq).toBe(types.length);
  return { events, snap: snap! };
}

describe('#15 invite', () => {
  it('invites an Uninvited worker: 200, invitedAt set, one event with the full new row, seq + 1', async () => {
    const { store, act } = await setup();
    const res = await act('amara', 'invite');
    expect(res.statusCode).toBe(200);
    expect(worker(res)).toMatchObject({ participation: 'invited', attendance: 'not_started', version: 1 });
    expect(worker(res).invitedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(res.json.seq).toBe(1);

    const { events } = await expectLog(store, ['invite']);
    expect(events[0]).toMatchObject({ workerId: 'amara', actor: 'manager', row: worker(res) });
  });

  it('re-invites a Declined worker, keeping the original invitedAt', async () => {
    const { store, act } = await setup();
    const first = worker(await act('liam', 'invite'));
    expect((await act('liam', 'decline')).statusCode).toBe(200);
    const again = await act('liam', 'invite');
    expect(again.statusCode).toBe(200);
    expect(worker(again)).toMatchObject({ participation: 'invited', invitedAt: first.invitedAt, version: 3 });
    await expectLog(store, ['invite', 'decline', 'invite']);
  });

  it('inviting an already Invited worker returns 200 with the original invitedAt and writes no event', async () => {
    const { store, act } = await setup();
    const first = worker(await act('amara', 'invite'));
    const repeat = await act('amara', 'invite');
    expect(repeat.statusCode).toBe(200);
    expect(worker(repeat)).toEqual(first);
    await expectLog(store, ['invite']);
  });

  it.each([
    ['accepted', ['invite', 'accept']],
    ['cancelled', ['invite', 'accept', 'cancel']],
  ] as const)('refuses to invite a %s worker with 409, the current row and a reason', async (state, steps) => {
    const { store, act } = await setup();
    for (const s of steps) expect((await act('sofia', s)).statusCode).toBe(200);
    const res = await act('sofia', 'invite');
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('INVALID_TRANSITION');
    expect(res.json.message).toMatch(/Can't invite Sofia Rossi/);
    expect((res.json.current as Worker).participation).toBe(state);
    await expectLog(store, [...steps]);
  });

  it.each([
    ['malformed JSON', { raw: '{nope' }],
    ['unknown action', { body: { action: 'promote' } }],
    ['unexpected field', { body: { action: 'invite', extra: 1 } }],
    ['negative expectedVersion', { body: { action: 'invite', expectedVersion: -1 } }],
    ['missing Idempotency-Key', { body: { action: 'invite' }, key: null }],
    ['too-short Idempotency-Key', { body: { action: 'invite' }, key: 'abc' }],
  ])('rejects %s with 422 and writes nothing', async (_, c) => {
    const { store, post } = await setup();
    const res = await post('amara', 'body' in c ? c.body : undefined, {
      raw: 'raw' in c ? c.raw : undefined,
      key: 'key' in c ? c.key : undefined,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json.code).toBe('VALIDATION_FAILED');
    expect(typeof res.json.message).toBe('string');
    await expectLog(store, []);
  });

  it('answers 404 for an unknown worker or shift', async () => {
    const { act } = await setup();
    const res = await act('ghost', 'invite');
    expect(res.statusCode).toBe(404);
    expect(res.json).toEqual({ code: 'WORKER_NOT_FOUND', message: 'Worker "ghost" is not on this shift.' });
  });
});

describe('#16 accept, decline, cancel and capacity', () => {
  it('accepts from Invited and from Cancelled; refuses from Uninvited and Declined', async () => {
    const { store, act } = await setup();
    expect((await act('amara', 'accept')).statusCode).toBe(409); // Uninvited
    await act('amara', 'invite');
    const accepted = await act('amara', 'accept');
    expect(accepted.statusCode).toBe(200);
    expect(worker(accepted)).toMatchObject({ participation: 'accepted' });
    const respondedAt = worker(accepted).respondedAt;
    expect(respondedAt).not.toBeNull();

    await act('amara', 'cancel');
    const reaccepted = await act('amara', 'accept');
    expect(reaccepted.statusCode).toBe(200);
    // Timestamps are never overwritten, even on re-accept.
    expect(worker(reaccepted)).toMatchObject({ participation: 'accepted', respondedAt });

    await act('liam', 'invite');
    await act('liam', 'decline');
    const declined = await act('liam', 'accept');
    expect(declined.statusCode).toBe(409);
    expect(declined.json.code).toBe('INVALID_TRANSITION');
    await expectLog(store, ['invite', 'accept', 'cancel', 'accept', 'invite', 'decline']);
  });

  it('accepted workers cannot decline', async () => {
    const { act } = await setup();
    await act('amara', 'invite');
    await act('amara', 'accept');
    const res = await act('amara', 'decline');
    expect(res.statusCode).toBe(409);
    expect(res.json.message).toBe("Can't decline Amara Okafor: they are Accepted.");
  });

  it('accept on a full shift → 409 SHIFT_FULL "No places left"', async () => {
    const { store, act } = await setup({ ...SEED, shift: { ...SEED.shift, required: 1 } });
    await act('amara', 'invite');
    await act('liam', 'invite');
    expect((await act('amara', 'accept')).statusCode).toBe(200);
    const full = await act('liam', 'accept');
    expect(full.statusCode).toBe(409);
    expect(full.json).toMatchObject({ code: 'SHIFT_FULL', message: 'No places left' });
    // Invitations are still allowed when full.
    expect((await act('sofia', 'invite')).statusCode).toBe(200);
    await expectLog(store, ['invite', 'invite', 'accept', 'invite']);
  });

  it('cancel works only from Accepted + Not started, and frees the place', async () => {
    const { store, act } = await setup({ ...SEED, shift: { ...SEED.shift, required: 1 } });
    expect((await act('amara', 'cancel')).statusCode).toBe(409); // Uninvited
    await act('amara', 'invite');
    expect((await act('amara', 'cancel')).statusCode).toBe(409); // Invited
    await act('amara', 'accept');
    expect((await act('amara', 'cancel')).statusCode).toBe(200);
    await act('liam', 'invite');
    expect((await act('liam', 'accept')).statusCode).toBe(200); // the place was freed
    const { snap } = await expectLog(store, ['invite', 'accept', 'cancel', 'invite', 'accept']);
    expect(snap.shift.acceptedCount).toBe(1);
  });

  it('acceptedCount equals the derived filled count after every step of a scripted sequence', async () => {
    const { store, act } = await setup({ ...SEED, shift: { ...SEED.shift, required: 2 } });
    const script: [string, Action][] = [
      ['amara', 'invite'], ['liam', 'invite'], ['sofia', 'invite'],
      ['amara', 'accept'], ['liam', 'accept'], ['sofia', 'accept'], // third is SHIFT_FULL
      ['liam', 'cancel'], ['sofia', 'accept'], ['liam', 'accept'], // liam now full
      ['amara', 'cancel'], ['liam', 'accept'], ['sofia', 'decline'], // decline refused: Accepted
    ];
    for (const [w, a] of script) {
      await act(w, a);
      const snap = (await store.getSnapshot(SHIFT))!;
      const { filled, remaining } = deriveCounts(snap.workers, snap.shift.required);
      expect(snap.shift.acceptedCount).toBe(filled);
      expect(filled).toBeLessThanOrEqual(snap.shift.required);
      expect(remaining).toBe(snap.shift.required - filled);
    }
    const snap = (await store.getSnapshot(SHIFT))!;
    expect(snap.workers.filter((w) => w.participation === 'accepted').map((w) => w.id).sort()).toEqual(['liam', 'sofia']);
  });
});

describe('#17 retry safety', () => {
  it('the same Idempotency-Key twice returns byte-identical bodies and changes nothing the second time', async () => {
    const { store, act } = await setup();
    await act('amara', 'invite');
    const key = randomUUID();
    const first = await act('amara', 'accept', {}, key);
    await act('amara', 'cancel');
    const replay = await act('amara', 'accept', {}, key);
    expect(replay.statusCode).toBe(first.statusCode);
    expect(replay.body).toBe(first.body);
    // The replay did not re-accept: amara is still Cancelled.
    const { snap } = await expectLog(store, ['invite', 'accept', 'cancel']);
    expect(snap.workers.find((w) => w.id === 'amara')!.participation).toBe('cancelled');
  });

  it('replays a 409 too, so a retried refused action stays refused', async () => {
    const { act } = await setup();
    const key = randomUUID();
    const first = await act('amara', 'accept', {}, key);
    expect(first.statusCode).toBe(409);
    expect((await act('amara', 'accept', {}, key)).body).toBe(first.body);
  });

  it('refuses to reuse a key for a different request', async () => {
    const { act } = await setup();
    const key = randomUUID();
    await act('amara', 'invite', {}, key);
    const res = await act('amara', 'invite', { expectedVersion: 0 }, key);
    expect(res.statusCode).toBe(422);
    expect(res.json.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a stale expectedVersion → 409 VERSION_CONFLICT with the current row', async () => {
    const { store, act } = await setup();
    const invited = worker(await act('amara', 'invite', { expectedVersion: 0 }));
    const stale = await act('amara', 'decline', { expectedVersion: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json).toMatchObject({ code: 'VERSION_CONFLICT', current: invited });
    expect(stale.json.message).toMatch(/changed since you loaded it/);
    expect((await act('amara', 'decline', { expectedVersion: 1 })).statusCode).toBe(200);
    await expectLog(store, ['invite', 'decline']);
  });

  it('20 parallel identical accepts → one state change, one event, contiguous seq, the same respondedAt', async () => {
    const { store, act } = await setup();
    await act('amara', 'invite');
    const results = await Promise.all(Array.from({ length: 20 }, () => act('amara', 'accept')));
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(200));
    const stamps = new Set(results.map((r) => worker(r).respondedAt));
    expect(stamps.size).toBe(1);
    expect([...stamps][0]).not.toBeNull();
    expect(new Set(results.map((r) => worker(r).version))).toEqual(new Set([2]));
    const { snap } = await expectLog(store, ['invite', 'accept']);
    expect(snap.shift.acceptedCount).toBe(1);
  });

  it('2 places, 3 workers racing to accept → exactly 2 accepted, 1 SHIFT_FULL', async () => {
    const { store, act } = await setup({ ...SEED, shift: { ...SEED.shift, required: 2 } });
    for (const w of ['amara', 'liam', 'sofia']) await act(w, 'invite');
    const results = await Promise.all(['amara', 'liam', 'sofia'].map((w) => act(w, 'accept')));
    const codes = results.map((r) => (r.statusCode === 200 ? 'ok' : r.json.code)).sort();
    expect(codes).toEqual(['SHIFT_FULL', 'ok', 'ok']);
    const { snap } = await expectLog(store, ['invite', 'invite', 'invite', 'accept', 'accept']);
    expect(snap.shift.acceptedCount).toBe(2);
    expect(deriveCounts(snap.workers, 2).filled).toBe(2);
  });
});
