import { applyAction, type Action, type Snapshot } from '@staffing/domain';
import { vi } from 'vitest';
import { jsonResponse } from './render';

export type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };

/**
 * An in-memory API that applies actions with the real domain rules, so UI tests
 * exercise the same transitions the server does. `nextPost` queues canned
 * responses (or thrown errors) for the following POSTs.
 */
export function fakeApi(initial: Snapshot) {
  let snap: Snapshot = structuredClone(initial);
  const calls: Call[] = [];
  const nextPost: (Response | Error)[] = [];
  let clock = Date.parse('2026-12-12T20:00:00.000Z');
  let gate: Promise<void> | null = null;

  const fetchFn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body });
    if (method === 'GET') return jsonResponse(200, snap);
    if (gate) await gate;

    const canned = nextPost.shift();
    if (canned instanceof Error) throw canned;
    if (canned) return canned;

    const workerId = url.split('/')[5]!;
    const current = snap.workers.find((w) => w.id === workerId)!;
    clock += 60_000;
    const r = applyAction(current, (body as { action: Action }).action, {
      now: new Date(clock).toISOString(),
      acceptedCount: snap.shift.acceptedCount,
      required: snap.shift.required,
      expectedVersion: (body as { expectedVersion?: number }).expectedVersion,
    });
    if (r.kind === 'rejected') return jsonResponse(409, { code: r.code, message: r.message, current: r.current });
    if (r.kind === 'already') return jsonResponse(200, { worker: r.worker });
    snap = {
      shift: { ...snap.shift, acceptedCount: snap.shift.acceptedCount + r.acceptedDelta },
      workers: snap.workers.map((w) => (w.id === workerId ? r.worker : w)),
      seq: snap.seq + 1,
    };
    return jsonResponse(200, { worker: r.worker, seq: snap.seq });
  });
  vi.stubGlobal('fetch', fetchFn);

  return {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    nextPost,
    get snapshot() {
      return snap;
    },
    /** Hold every POST until the returned release function is called. */
    holdPosts() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    /** Change server state behind the page's back (another session). */
    setSnapshot(next: Snapshot) {
      snap = structuredClone(next);
    },
  };
}
