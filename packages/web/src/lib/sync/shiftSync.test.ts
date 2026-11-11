import {
  applyAction,
  MAX_EVENTS_PAGE,
  type Action,
  type ShiftEventMessage,
  type Snapshot,
  type Worker,
} from '@staffing/domain';
import { describe, expect, it } from 'vitest';
import { fakeTransport } from '../../test/fakeTransport';
import {
  backoffDelay,
  createShiftSync,
  VERIFY_AFTER_MS,
  VERIFY_EVERY_MS,
  type SyncOptions,
} from './shiftSync';

const SHIFT = 'harbourfront-gala';
const T0 = Date.parse('2026-12-12T20:00:00.000Z');

const worker = (id: string): Worker => ({
  id,
  name: id.toUpperCase(),
  participation: 'uninvited',
  attendance: 'not_started',
  invitedAt: null,
  respondedAt: null,
  checkedInAt: null,
  checkedOutAt: null,
  version: 0,
});

function initialSnapshot(): Snapshot {
  return {
    shift: {
      id: SHIFT,
      title: 'Gala',
      location: 'Hall',
      startsAt: '2026-12-12T22:00:00.000Z',
      endsAt: '2026-12-13T04:00:00.000Z',
      timezone: 'America/Toronto',
      required: 3,
      acceptedCount: 0,
    },
    workers: [worker('amara'), worker('liam'), worker('sofia')],
    seq: 0,
    epoch: 1,
  };
}

/** A tiny server: applies actions with the real domain rules and keeps the event log. */
function fakeServer() {
  let snap = initialSnapshot();
  const events: ShiftEventMessage[] = [];
  const calls: string[] = [];
  let failNext = 0;
  return {
    calls,
    events,
    get snapshot() {
      return snap;
    },
    failNextFetches(n: number) {
      failNext = n;
    },
    act(workerId: string, action: Action): ShiftEventMessage {
      const current = snap.workers.find((w) => w.id === workerId)!;
      const at = new Date(T0 + events.length * 60_000).toISOString();
      const r = applyAction(current, action, {
        now: at,
        acceptedCount: snap.shift.acceptedCount,
        required: snap.shift.required,
      });
      if (r.kind !== 'applied') throw new Error(`${action} not applied: ${r.kind}`);
      const seq = snap.seq + 1;
      snap = {
        shift: { ...snap.shift, acceptedCount: snap.shift.acceptedCount + r.acceptedDelta },
        workers: snap.workers.map((w) => (w.id === workerId ? r.worker : w)),
        seq,
        epoch: snap.epoch,
      };
      const e = { seq, type: action, workerId, row: r.worker, at, epoch: snap.epoch };
      events.push(e);
      return e;
    },
    /** A reset: the starting state, an empty log, the next epoch. Returns the live reset message. */
    reset() {
      snap = { ...initialSnapshot(), epoch: snap.epoch + 1 };
      events.length = 0;
      return { kind: 'reset' as const, epoch: snap.epoch };
    },
    api: {
      async fetchEvents(_shiftId: string, after: number) {
        calls.push(`events:${after}`);
        if (failNext > 0) {
          failNext--;
          throw new Error('network');
        }
        const rest = events.filter((e) => e.seq > after);
        return {
          events: rest.slice(0, MAX_EVENTS_PAGE),
          hasMore: rest.length > MAX_EVENTS_PAGE,
          epoch: snap.epoch,
        };
      },
      async fetchSnapshot() {
        calls.push('snapshot');
        return structuredClone(snap);
      },
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(extra: Partial<SyncOptions> = {}) {
  const server = fakeServer();
  const t = fakeTransport();
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const published: Snapshot[] = [];
  let clock = T0;
  const sync = createShiftSync({
    shiftId: SHIFT,
    transport: t.transport,
    api: {
      fetchEvents: async (id, after) => {
        t.log.push(`fetch:${after}`);
        return server.api.fetchEvents(id, after);
      },
      fetchSnapshot: server.api.fetchSnapshot,
    },
    onSnapshot: (s) => published.push(s),
    now: () => clock,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    ...extra,
  });
  const pendingTimers = () => timers.filter((x) => !x.cleared);
  /** Timers other than the periodic verify read (backoffs, retries). */
  const isVerify = (x: { ms: number }) => x.ms === VERIFY_AFTER_MS || x.ms === VERIFY_EVERY_MS;
  return {
    sync,
    server,
    t,
    timers,
    published,
    latest: () => published.at(-1),
    setClock: (ms: number) => (clock = ms),
    /** Fires every pending timer once. */
    async runTimers() {
      const due = pendingTimers();
      for (const x of due) x.cleared = true;
      for (const x of due) x.fn();
      await flush();
    },
    pendingTimers,
    otherTimers: () => timers.filter((x) => !isVerify(x)),
    pendingOther: () => pendingTimers().filter((x) => !isVerify(x)),
  };
}

/** Started, subscribed and holding the initial snapshot, with the initial catch-up done. */
async function live(extra: Partial<SyncOptions> = {}) {
  const s = setup(extra);
  s.sync.start();
  s.sync.adoptSnapshot(initialSnapshot());
  s.t.last.subscribed();
  await flush();
  s.server.calls.length = 0;
  return s;
}

describe('shift sync', () => {
  it('subscribes on the shift channel before it reads missed events', async () => {
    const s = setup();
    s.sync.start();
    s.sync.adoptSnapshot(initialSnapshot());
    await flush();
    expect(s.t.last.channel).toBe('/shifts/harbourfront-gala');
    expect(s.server.calls).toEqual([]); // nothing read before the subscription is confirmed

    s.t.last.subscribed();
    await flush();
    expect(s.t.log).toEqual(['connect', 'subscribed', 'fetch:0']);
  });

  it('applies the next event and ignores duplicates', async () => {
    const s = await live();
    const e1 = s.server.act('amara', 'invite');
    s.t.last.send(e1);
    s.t.last.send(e1);
    s.t.last.send(structuredClone(e1));
    await flush();
    expect(s.published).toHaveLength(1);
    expect(s.latest()!.seq).toBe(1);
    expect(s.latest()!.workers.find((w) => w.id === 'amara')!.participation).toBe('invited');
    expect(s.server.calls).toEqual([]); // duplicates never cause a read
  });

  it('ends in the same state whether events arrive in order or out of order', async () => {
    const inOrder = await live();
    const outOfOrder = await live();
    // Both clients see the same server history.
    const history: ShiftEventMessage[] = [];
    for (const [w, a] of [
      ['amara', 'invite'],
      ['amara', 'accept'],
      ['liam', 'invite'],
      ['amara', 'check_in'],
      ['liam', 'decline'],
    ] as const) {
      history.push(inOrder.server.act(w, a));
      outOfOrder.server.act(w, a);
    }

    for (const e of history) inOrder.t.last.send(e);
    for (const i of [2, 0, 4, 1, 3, 0, 2]) outOfOrder.t.last.send(history[i]);
    await flush();
    await flush();

    expect(inOrder.latest()!.seq).toBe(5);
    expect(outOfOrder.latest()).toEqual(inOrder.latest());
    expect(outOfOrder.latest()).toEqual(inOrder.server.snapshot);
  });

  it('a gap triggers exactly one catch-up read', async () => {
    const s = await live();
    const e1 = s.server.act('amara', 'invite');
    const e2 = s.server.act('liam', 'invite');
    const e3 = s.server.act('sofia', 'invite');
    void e1; // lost on the way
    s.t.last.send(e2);
    s.t.last.send(e3);
    await flush();
    expect(s.server.calls).toEqual(['events:0']);
    expect(s.latest()!.seq).toBe(3);
  });

  it('reads again when events arrived that the catch-up did not include yet', async () => {
    const s = await live();
    s.server.act('amara', 'invite');
    const e2 = s.server.act('liam', 'invite');
    // The read is answered from a log that does not have e3 yet; e3 lands meanwhile.
    s.t.last.send(e2);
    const e3 = s.server.act('sofia', 'invite');
    s.t.last.send(e3);
    await flush();
    await flush();
    expect(s.latest()!.seq).toBe(3);
  });

  it('falls back to the snapshot when the gap is bigger than one page', async () => {
    const s = await live();
    for (let i = 0; i < MAX_EVENTS_PAGE + 3; i++) s.server.act('amara', i % 2 === 0 ? 'invite' : 'decline');
    s.t.last.send(s.server.events.at(-1));
    await flush();
    await flush();
    expect(s.server.calls).toEqual(['events:0', 'snapshot', `events:${MAX_EVENTS_PAGE + 3}`]);
    expect(s.latest()).toEqual(s.server.snapshot);
  });

  it('ignores messages that are not valid events', async () => {
    const s = await live();
    s.t.last.send({ hello: 'world' });
    s.t.last.send({ seq: 1, type: 'invite', workerId: 'amara', row: { id: 'amara' }, at: 'now' });
    s.t.last.send('garbage');
    await flush();
    expect(s.published).toEqual([]);
    expect(s.server.calls).toEqual([]);
  });

  it('goes Live → Reconnecting → Live and catches up on what it missed', async () => {
    const s = await live();
    const statuses: string[] = [s.sync.getState().status];
    s.sync.subscribe(() => statuses.push(s.sync.getState().status));

    s.t.last.drop('keep-alive timeout');
    expect(s.sync.getState().status).toBe('reconnecting');
    expect(s.pendingOther().map((x) => x.ms)).toEqual([250]);

    // Changes made while the page was disconnected.
    s.server.act('amara', 'invite');
    s.server.act('amara', 'accept');

    await s.runTimers();
    expect(s.t.connections).toHaveLength(2);
    expect(s.server.calls).toEqual([]); // still not subscribed: nothing read yet
    s.t.last.subscribed();
    await flush();

    expect(statuses).toEqual(['live', 'reconnecting', 'live']);
    expect(s.server.calls).toEqual(['events:0']);
    expect(s.latest()).toEqual(s.server.snapshot);
  });

  it('backs off between failed attempts and resets once subscribed', async () => {
    const s = await live();
    s.t.last.drop();
    for (let i = 0; i < 6; i++) {
      await s.runTimers();
      s.t.last.drop('refused');
    }
    expect(s.otherTimers().map((x) => x.ms)).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000]);

    await s.runTimers();
    s.t.last.subscribed();
    s.t.last.drop();
    expect(s.pendingOther().map((x) => x.ms)).toEqual([250]);
  });

  it('adds jitter to the backoff and never waits more than 5 s', () => {
    expect(backoffDelay(0, () => 0)).toBe(200);
    expect(backoffDelay(0, () => 1)).toBe(300);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
    for (let a = 0; a < 20; a++) expect(backoffDelay(a, () => 1)).toBeLessThanOrEqual(5000);
  });

  it('shows Offline while the browser is offline and reconnects when it is back', async () => {
    const s = await live();
    s.sync.setOnline(false);
    expect(s.sync.getState().status).toBe('offline');
    expect(s.t.last.closed).toBe(true);
    expect(s.pendingTimers()).toEqual([]); // no point retrying while offline

    s.sync.setOnline(true);
    expect(s.sync.getState().status).toBe('reconnecting');
    expect(s.t.connections).toHaveLength(2);
    s.t.last.subscribed();
    expect(s.sync.getState().status).toBe('live');
  });

  it('a simulated outage closes the socket and blocks reconnects until switched off', async () => {
    const s = await live();
    s.sync.setBlocked(true);
    expect(s.sync.getState().status).toBe('reconnecting');
    expect(s.t.last.closed).toBe(true);
    expect(s.pendingTimers()).toEqual([]);

    s.server.act('liam', 'invite');
    s.sync.setBlocked(false);
    expect(s.t.connections).toHaveLength(2);
    s.t.last.subscribed();
    await flush();
    expect(s.sync.getState().status).toBe('live');
    expect(s.latest()!.workers.find((w) => w.id === 'liam')!.participation).toBe('invited');
  });

  it('ignores callbacks from a connection it already closed', async () => {
    const s = await live();
    const old = s.t.last;
    s.sync.setBlocked(true);
    s.sync.setBlocked(false);
    old.handlers.onClose('late');
    old.handlers.onMessage(s.server.act('amara', 'invite'));
    expect(s.sync.getState().status).toBe('reconnecting'); // waiting on the new connection, not on a timer
    expect(s.pendingTimers()).toEqual([]);
    expect(s.published).toEqual([]);
  });

  it('retries a failed catch-up read with backoff', async () => {
    const s = await live();
    s.server.failNextFetches(1);
    s.server.act('amara', 'invite');
    s.t.last.send(s.server.act('liam', 'invite')); // gap → read fails
    await flush();
    expect(s.latest()).toBeUndefined();
    await s.runTimers();
    expect(s.server.calls).toEqual(['events:0', 'events:0']);
    expect(s.latest()!.seq).toBe(2);
  });

  it('shows the approximate delay of the last live event', async () => {
    const s = await live();
    const e1 = s.server.act('amara', 'invite');
    s.setClock(Date.parse(e1.at) + 180);
    s.t.last.send(e1);
    expect(s.sync.getState().latencyMs).toBe(180);

    // Changes fed from an API response or a catch-up do not count as live.
    s.sync.ingest(2, s.server.act('liam', 'invite').row);
    expect(s.sync.getState().latencyMs).toBe(180);
  });

  it('reports each applied event once, in seq order, from pushes and catch-up alike', async () => {
    const seen: number[] = [];
    const s = await live({ onEvent: (e) => seen.push(e.seq) });
    const e1 = s.server.act('amara', 'invite');
    s.t.last.send(e1);
    s.t.last.send(e1); // duplicate
    s.server.act('liam', 'invite'); // push lost
    const e3 = s.server.act('sofia', 'invite');
    s.t.last.send(e3); // gap → catch-up reads 2 and 3
    await flush();
    const e4 = s.server.act('amara', 'accept');
    s.sync.ingest(e4.seq, e4.row); // from an action response: no full event to report
    s.t.last.send(e4);
    await flush();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('applies a change from an action response, then ignores its push', async () => {
    const s = await live();
    const e1 = s.server.act('amara', 'invite');
    s.sync.ingest(e1.seq, e1.row);
    s.t.last.send(e1);
    await flush();
    expect(s.published).toHaveLength(1);
    expect(s.latest()!.seq).toBe(1);
  });

  it('puts its newer state back when a stale snapshot is offered', async () => {
    const s = await live();
    s.t.last.send(s.server.act('amara', 'invite'));
    const stale = initialSnapshot();
    s.sync.adoptSnapshot(stale);
    expect(s.published).toHaveLength(2);
    expect(s.latest()!.seq).toBe(1);

    // A newer snapshot replaces ours without being echoed back.
    s.server.act('liam', 'invite');
    s.sync.adoptSnapshot(structuredClone(s.server.snapshot));
    expect(s.published).toHaveLength(2);
    s.t.last.send(s.server.act('sofia', 'invite'));
    expect(s.latest()!.seq).toBe(3);
  });

  it('catches up when the first snapshot arrives after the subscription', async () => {
    const s = setup();
    s.sync.start();
    s.t.last.subscribed();
    await flush();
    expect(s.server.calls).toEqual([]); // nothing to catch up from yet
    s.server.act('amara', 'invite');
    s.sync.adoptSnapshot(initialSnapshot()); // read before that invite
    await flush();
    expect(s.server.calls).toEqual(['events:0']);
    expect(s.latest()!.seq).toBe(1);
  });

  it('finds a lost last event with one catch-up read once live events go quiet', async () => {
    const s = await live();
    s.t.last.send(s.server.act('amara', 'invite'));
    s.t.last.send(s.server.act('amara', 'accept'));
    s.server.act('amara', 'check_in'); // published, but never delivered
    expect(s.latest()!.seq).toBe(2);
    expect(s.server.calls).toEqual([]); // nothing after it, so no gap to notice

    // One verify timer for the whole burst, then one read that finds seq 3.
    const verify = s.pendingTimers().filter((x) => x.ms === VERIFY_AFTER_MS);
    expect(verify).toHaveLength(1);
    await s.runTimers();
    expect(s.server.calls).toEqual(['events:2']);
    expect(s.latest()!.seq).toBe(3);
  });

  it('reads what it missed every few seconds while Live, even when no push arrives at all', async () => {
    const s = await live();
    s.server.act('amara', 'invite'); // published, but this page never gets it
    expect(s.pendingTimers().map((x) => x.ms)).toEqual([VERIFY_EVERY_MS]);
    await s.runTimers();
    expect(s.server.calls).toEqual(['events:0']);
    expect(s.latest()!.seq).toBe(1);
    expect(s.pendingTimers().map((x) => x.ms)).toEqual([VERIFY_EVERY_MS]); // and keeps going

    // Not while disconnected.
    s.sync.setBlocked(true);
    expect(s.pendingTimers()).toEqual([]);
  });

  describe('resets (epoch)', () => {
    it('a live reset message with a newer epoch adopts the lower-seq server snapshot', async () => {
      const resets: Snapshot[] = [];
      const s = await live({ onReset: (snap) => resets.push(snap) });
      s.t.last.send(s.server.act('amara', 'invite'));
      s.t.last.send(s.server.act('amara', 'accept'));
      expect(s.latest()!.seq).toBe(2);

      s.t.last.send(s.server.reset());
      await flush();
      expect(s.latest()).toMatchObject({ seq: 0, epoch: 2 });
      expect(s.latest()!.workers.every((w) => w.participation === 'uninvited')).toBe(true);
      expect(resets.map((r) => r.epoch)).toEqual([2]);

      // New events start again from seq 1 and apply as usual.
      s.t.last.send(s.server.act('liam', 'invite'));
      expect(s.latest()).toMatchObject({ seq: 1, epoch: 2 });
    });

    it('ignores a reset message for an older or equal epoch', async () => {
      const resets: Snapshot[] = [];
      const s = await live({ onReset: (snap) => resets.push(snap) });
      s.t.last.send(s.server.act('amara', 'invite'));
      s.t.last.send({ kind: 'reset', epoch: 1 });
      await flush();
      expect(s.server.calls).not.toContain('snapshot');
      expect(s.latest()!.seq).toBe(1);
      expect(resets).toEqual([]);
    });

    it('never rolls back to a snapshot from an older epoch', async () => {
      const s = await live();
      const old = structuredClone(s.server.snapshot); // epoch 1
      s.t.last.send(s.server.reset());
      await flush();
      s.sync.adoptSnapshot(old);
      expect(s.latest()).toMatchObject({ epoch: 2 }); // ours is put back
    });

    it('drops a change from before the reset that is delivered late', async () => {
      const s = await live();
      const late = s.server.act('amara', 'invite'); // seq 1, epoch 1, not delivered yet
      s.t.last.send(s.server.reset());
      await flush();
      s.t.last.send(late); // seq 1 would otherwise look like the next change
      expect(s.latest()).toMatchObject({ seq: 0, epoch: 2 });
      expect(s.latest()!.workers.find((w) => w.id === 'amara')!.participation).toBe('uninvited');
    });

    it('a page in outage during a reset resets itself from the catch-up when it reconnects', async () => {
      const resets: Snapshot[] = [];
      const s = await live({ onReset: (snap) => resets.push(snap) });
      s.t.last.send(s.server.act('amara', 'invite'));
      s.sync.setBlocked(true);
      s.server.act('amara', 'accept');
      s.server.reset(); // the live reset message is missed
      s.server.act('liam', 'invite');

      s.sync.setBlocked(false);
      s.t.last.subscribed();
      await flush();
      await flush();
      expect(resets.map((r) => r.epoch)).toEqual([2]);
      expect(s.latest()).toMatchObject({ seq: 1, epoch: 2 });
      expect(s.latest()!.workers.find((w) => w.id === 'liam')!.participation).toBe('invited');
      expect(s.latest()!.workers.find((w) => w.id === 'amara')!.participation).toBe('uninvited');
    });

    it('a refetched snapshot with a newer epoch counts as a reset', async () => {
      const resets: Snapshot[] = [];
      const s = await live({ onReset: (snap) => resets.push(snap) });
      s.t.last.send(s.server.act('amara', 'invite'));
      s.server.reset();
      s.sync.adoptSnapshot(structuredClone(s.server.snapshot));
      expect(resets.map((r) => r.epoch)).toEqual([2]);
      expect(s.latest()).toMatchObject({ seq: 0, epoch: 2 });
    });

    it('retries when the snapshot it reads is still from before the announced reset', async () => {
      const s = await live();
      s.t.last.send({ kind: 'reset', epoch: 2 }); // announced, but the server read is still epoch 1
      await flush();
      expect(s.published).toEqual([]); // nothing adopted from the stale read
      expect(s.pendingOther()).toHaveLength(1); // a retry is scheduled
      s.server.reset();
      await s.runTimers();
      await flush();
      expect(s.latest()).toMatchObject({ seq: 0, epoch: 2 });
    });
  });

  it('stops cleanly: no reconnects and no callbacks after stop', async () => {
    const s = await live();
    const c = s.t.last;
    s.sync.stop();
    expect(c.closed).toBe(true);
    c.handlers.onClose('late');
    expect(s.pendingTimers()).toEqual([]);
  });
});
