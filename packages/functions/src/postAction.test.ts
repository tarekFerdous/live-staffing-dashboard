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
  ] as const)(
    'refuses to invite a %s worker with 409, the current row and a reason',
    async (state, steps) => {
      const { store, act } = await setup();
      for (const s of steps) expect((await act('sofia', s)).statusCode).toBe(200);
      const res = await act('sofia', 'invite');
      expect(res.statusCode).toBe(409);
      expect(res.json.code).toBe('INVALID_TRANSITION');
      expect(res.json.message).toMatch(/Can't invite Sofia Rossi/);
      expect((res.json.current as Worker).participation).toBe(state);
      await expectLog(store, [...steps]);
    },
  );

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

describe('#76 body size cap', () => {
  /** The action endpoint over a store that records every call made to it. */
  async function spied() {
    const { client, doc, tableName, idempotencyTableName } = await dynamo.newTable('size');
    const real = createShiftStore(doc, tableName);
    await real.resetShift(SEED);
    const calls: string[] = [];
    const store = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const handler = makeActionHandler({ store, idempotency: { client, tableName: idempotencyTableName } });
    const post = async (body: string, isBase64Encoded = false) => {
      const res = await handler({
        rawPath: `/api/shifts/${SHIFT}/workers/amara/actions`,
        headers: { 'idempotency-key': randomUUID() },
        pathParameters: { shiftId: SHIFT, workerId: 'amara' },
        body: isBase64Encoded ? Buffer.from(body).toString('base64') : body,
        isBase64Encoded,
      } as unknown as HttpEvent);
      return { ...res, json: JSON.parse(res.body) as Record<string, unknown> };
    };
    return { calls, post };
  }
  /** A valid invite body padded with trailing spaces to exactly `bytes` bytes. */
  const padded = (bytes: number) => JSON.stringify({ action: 'invite' }).padEnd(bytes, ' ');

  it('refuses a 1,025-byte body with 413 in the usual error shape, without touching the store', async () => {
    const { calls, post } = await spied();
    for (const encoded of [false, true]) {
      const res = await post(padded(1025), encoded);
      expect(res.statusCode).toBe(413);
      expect(Object.keys(res.json).sort()).toEqual(['code', 'message']);
      expect(res.json.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.headers?.['content-type']).toBe('application/json');
    }
    expect(calls).toEqual([]);
  });

  it('still accepts a normal action body, and one of exactly 1 KB', async () => {
    const { calls, post } = await spied();
    const res = await post(padded(1024));
    expect(res.statusCode).toBe(200);
    expect(worker(res).participation).toBe('invited');
    expect(calls).toContain('applyAction');
    expect((await post(JSON.stringify({ action: 'decline' }), true)).statusCode).toBe(200);
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
      ['amara', 'invite'],
      ['liam', 'invite'],
      ['sofia', 'invite'],
      ['amara', 'accept'],
      ['liam', 'accept'],
      ['sofia', 'accept'], // third is SHIFT_FULL
      ['liam', 'cancel'],
      ['sofia', 'accept'],
      ['liam', 'accept'], // liam now full
      ['amara', 'cancel'],
      ['liam', 'accept'],
      ['sofia', 'decline'], // decline refused: Accepted
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
    expect(
      snap.workers
        .filter((w) => w.participation === 'accepted')
        .map((w) => w.id)
        .sort(),
    ).toEqual(['liam', 'sofia']);
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

describe('#18 check-in and check-out', () => {
  /** Invites and accepts `id`, so it can check in. */
  async function accepted(act: Awaited<ReturnType<typeof setup>>['act'], id = 'amara') {
    await act(id, 'invite');
    expect((await act(id, 'accept')).statusCode).toBe(200);
  }

  it('check-in then check-out: timestamps set once, participation stays Accepted, filled unchanged', async () => {
    const { store, act } = await setup();
    await accepted(act);
    const inRes = await act('amara', 'check_in');
    expect(inRes.statusCode).toBe(200);
    expect(worker(inRes)).toMatchObject({
      participation: 'accepted',
      attendance: 'checked_in',
      checkedOutAt: null,
    });
    expect(worker(inRes).checkedInAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    const outRes = await act('amara', 'check_out');
    expect(outRes.statusCode).toBe(200);
    expect(worker(outRes)).toMatchObject({
      participation: 'accepted',
      attendance: 'checked_out',
      checkedInAt: worker(inRes).checkedInAt,
    });
    expect(Date.parse(worker(outRes).checkedOutAt!)).toBeGreaterThanOrEqual(
      Date.parse(worker(inRes).checkedInAt!),
    );

    const { events, snap } = await expectLog(store, ['invite', 'accept', 'check_in', 'check_out']);
    expect(events[2]).toMatchObject({ actor: 'worker', row: worker(inRes) });
    expect(events[3]).toMatchObject({ actor: 'worker', row: worker(outRes) });
    expect(snap.shift.acceptedCount).toBe(1);
    expect(deriveCounts(snap.workers, snap.shift.required)).toMatchObject({
      filled: 1,
      checkedIn: 0,
      checkedOut: 1,
    });
  });

  it('a double check-in returns 200 with the original checkedInAt and writes no event', async () => {
    const { store, act } = await setup();
    await accepted(act);
    const first = worker(await act('amara', 'check_in'));
    const repeat = await act('amara', 'check_in');
    expect(repeat.statusCode).toBe(200);
    expect(worker(repeat)).toEqual(first);
    await expectLog(store, ['invite', 'accept', 'check_in']);
  });

  it('check-out before check-in → 409 with a reason', async () => {
    const { store, act } = await setup();
    await accepted(act);
    const res = await act('amara', 'check_out');
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: "Can't check out Amara Okafor: they are Accepted.",
    });
    await expectLog(store, ['invite', 'accept']);
  });

  it('check-in when not Accepted → 409', async () => {
    const { act } = await setup();
    await act('amara', 'invite');
    const res = await act('amara', 'check_in');
    expect(res.statusCode).toBe(409);
    expect(res.json.message).toBe("Can't check in Amara Okafor: they are Invited.");
  });

  it('check-in after check-out → 409; checked out is final', async () => {
    const { store, act } = await setup();
    await accepted(act);
    await act('amara', 'check_in');
    const out = worker(await act('amara', 'check_out'));
    const res = await act('amara', 'check_in');
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: "Can't check in Amara Okafor: they are Accepted and Checked out.",
      current: out,
    });
    const repeatOut = await act('amara', 'check_out');
    expect(repeatOut.statusCode).toBe(200); // a repeat, answered with the stored row
    expect(worker(repeatOut)).toEqual(out);
    await expectLog(store, ['invite', 'accept', 'check_in', 'check_out']);
  });

  it('cancel after check-in → 409, and the place stays filled', async () => {
    const { store, act } = await setup();
    await accepted(act);
    await act('amara', 'check_in');
    const res = await act('amara', 'cancel');
    expect(res.statusCode).toBe(409);
    expect(res.json).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: "Can't cancel Amara Okafor: they are Accepted and Checked in.",
    });
    const { snap } = await expectLog(store, ['invite', 'accept', 'check_in']);
    expect(snap.shift.acceptedCount).toBe(1);
  });

  it('20 parallel check-ins → one checkedInAt, one event, every response carries the same timestamp', async () => {
    const { store, act } = await setup();
    await accepted(act);
    const results = await Promise.all(Array.from({ length: 20 }, () => act('amara', 'check_in')));
    expect(results.map((r) => r.statusCode)).toEqual(Array(20).fill(200));
    const stamps = new Set(results.map((r) => worker(r).checkedInAt));
    expect(stamps.size).toBe(1);
    expect([...stamps][0]).not.toBeNull();
    expect(new Set(results.map((r) => worker(r).version))).toEqual(new Set([3]));
    const { snap } = await expectLog(store, ['invite', 'accept', 'check_in']);
    expect(snap.workers.find((w) => w.id === 'amara')!.checkedInAt).toBe([...stamps][0]);
  });

  it('filled keeps counting checked-in and checked-out workers', async () => {
    const { store, act } = await setup({ ...SEED, shift: { ...SEED.shift, required: 2 } });
    await accepted(act, 'amara');
    await accepted(act, 'liam');
    await act('amara', 'check_in');
    await act('liam', 'check_in');
    await act('liam', 'check_out');
    await act('sofia', 'invite');
    const full = await act('sofia', 'accept');
    expect(full.json.code).toBe('SHIFT_FULL');
    const snap = (await store.getSnapshot(SHIFT))!;
    expect(snap.shift.acceptedCount).toBe(2);
    expect(deriveCounts(snap.workers, 2)).toEqual({
      required: 2,
      filled: 2,
      remaining: 0,
      checkedIn: 1,
      checkedOut: 1,
    });
  });
});

describe('profile details survive every action', () => {
  it('invite, accept, check in, check out, cancel and decline keep role, phone, email, address', async () => {
    const { store, act } = await setup();
    const profile = (id: string) => {
      const { role, phone, email, address } = SEED.workers.find((w) => w.id === id)!;
      return { role, phone, email, address };
    };
    const steps: [string, Action][] = [
      ['amara', 'invite'],
      ['amara', 'accept'],
      ['amara', 'check_in'],
      ['amara', 'check_out'],
      ['liam', 'invite'],
      ['liam', 'accept'],
      ['liam', 'cancel'],
      ['sofia', 'invite'],
      ['sofia', 'decline'],
    ];
    for (const [id, action] of steps) {
      const res = await act(id, action);
      expect(res.statusCode, `${id} ${action}`).toBe(200);
      expect(worker(res)).toMatchObject(profile(id));
    }
    const { events, snap } = await expectLog(
      store,
      steps.map(([, a]) => a),
    );
    for (const e of events) expect(e.row).toMatchObject(profile(e.workerId));
    for (const w of snap.workers) expect(w).toMatchObject(profile(w.id));
  });
});
