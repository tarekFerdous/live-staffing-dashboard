import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction } from './apply';
import { deriveCounts } from './counts';
import type { Worker } from './schemas';
import { ACTIONS, type Action } from './transitions';

const T0 = '2026-12-12T20:00:00.000Z';
const T1 = '2026-12-12T21:00:00.000Z';

const row = (extra: Partial<Worker> = {}): Worker => ({
  id: 'amara',
  name: 'Amara Okafor',
  participation: 'uninvited',
  attendance: 'not_started',
  invitedAt: null,
  respondedAt: null,
  checkedInAt: null,
  checkedOutAt: null,
  version: 0,
  ...extra,
});
const ctx = { now: T1, acceptedCount: 0, required: 3 };

describe('applyAction', () => {
  it('invites an Uninvited worker, stamping invitedAt and bumping the version', () => {
    expect(applyAction(row(), 'invite', ctx)).toEqual({
      kind: 'applied',
      worker: row({ participation: 'invited', invitedAt: T1, version: 1 }),
      acceptedDelta: 0,
    });
  });

  it('re-invites a Declined worker but keeps the original invitedAt', () => {
    const r = applyAction(row({ participation: 'declined', invitedAt: T0, respondedAt: T0, version: 2 }), 'invite', ctx);
    expect(r).toMatchObject({ kind: 'applied', worker: { participation: 'invited', invitedAt: T0, version: 3 } });
  });

  it('answers a repeat with the stored row and no change', () => {
    const invited = row({ participation: 'invited', invitedAt: T0, version: 1 });
    expect(applyAction(invited, 'invite', ctx)).toEqual({ kind: 'already', worker: invited });
  });

  it.each(['accepted', 'cancelled'] as const)('refuses to invite a %s worker with a readable reason', (p) => {
    const r = applyAction(row({ participation: p }), 'invite', ctx);
    expect(r).toMatchObject({ kind: 'rejected', code: 'INVALID_TRANSITION' });
    expect(r.kind === 'rejected' && r.message).toMatch(/^Can't invite Amara Okafor: they are (Accepted|Cancelled)\.$/);
  });

  it('accept takes a place; cancel gives it back; a full shift refuses with SHIFT_FULL', () => {
    const invited = row({ participation: 'invited', invitedAt: T0, version: 1 });
    expect(applyAction(invited, 'accept', ctx)).toMatchObject({ kind: 'applied', acceptedDelta: 1 });
    expect(applyAction(row({ participation: 'accepted', version: 2 }), 'cancel', ctx)).toMatchObject({
      kind: 'applied',
      acceptedDelta: -1,
      worker: { participation: 'cancelled' },
    });
    expect(applyAction(invited, 'accept', { ...ctx, acceptedCount: 3 })).toMatchObject({
      kind: 'rejected',
      code: 'SHIFT_FULL',
      message: 'No places left',
    });
  });

  it('accepted workers cannot decline', () => {
    expect(applyAction(row({ participation: 'accepted' }), 'decline', ctx)).toMatchObject({
      kind: 'rejected',
      code: 'INVALID_TRANSITION',
    });
  });

  it('rejects a stale expectedVersion with the current row', () => {
    const invited = row({ participation: 'invited', version: 4 });
    expect(applyAction(invited, 'accept', { ...ctx, expectedVersion: 3 })).toMatchObject({
      kind: 'rejected',
      code: 'VERSION_CONFLICT',
      current: invited,
    });
    expect(applyAction(invited, 'accept', { ...ctx, expectedVersion: 4 })).toMatchObject({ kind: 'applied' });
  });
});

describe('applyAction properties (fast-check)', () => {
  const step = fc.record({
    worker: fc.nat({ max: 3 }),
    action: fc.constantFrom<Action>(...ACTIONS),
    staleVersion: fc.boolean(),
    minutes: fc.integer({ min: 1, max: 30 }),
  });

  it('random sequences keep filled = Accepted rows ≤ required and never change a set timestamp', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), fc.array(step, { maxLength: 60 }), (required, steps) => {
        let workers = [0, 1, 2, 3].map((i) => row({ id: `w${i}`, name: `Worker ${i}` }));
        let acceptedCount = 0;
        let clock = Date.parse(T0);

        for (const s of steps) {
          clock += s.minutes * 60_000;
          const before = workers[s.worker]!;
          const r = applyAction(before, s.action, {
            now: new Date(clock).toISOString(),
            acceptedCount,
            required,
            expectedVersion: s.staleVersion ? before.version + 1 : undefined,
          });
          if (r.kind === 'applied') {
            acceptedCount += r.acceptedDelta;
            workers = workers.map((w, i) => (i === s.worker ? r.worker : w));
            expect(r.worker.version).toBe(before.version + 1);
          } else {
            expect(r.kind === 'already' ? r.worker : r.current).toBe(before);
          }
          const after = workers[s.worker]!;

          // Stored counter and derived count never drift apart, and never exceed capacity.
          const { filled } = deriveCounts(workers, required);
          expect(acceptedCount).toBe(filled);
          expect(filled).toBeLessThanOrEqual(required);

          // A timestamp, once set, never changes.
          for (const f of ['invitedAt', 'respondedAt', 'checkedInAt', 'checkedOutAt'] as const) {
            if (before[f] !== null) expect(after[f]).toBe(before[f]);
          }
          // Attendance only moves for Accepted workers, and check-out never precedes check-in.
          if (after.attendance !== 'not_started') expect(after.participation).toBe('accepted');
          if (after.checkedOutAt) {
            expect(after.checkedInAt).not.toBeNull();
            expect(Date.parse(after.checkedOutAt)).toBeGreaterThanOrEqual(Date.parse(after.checkedInAt!));
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
