import { describe, expect, it } from 'vitest';
import { ATTENDANCES, PARTICIPATIONS } from './statuses';
import { ACTIONS, allowedActions, canApply, TRANSITIONS } from './transitions';

/**
 * The only (participation, attendance, action) triples PRD #3 and #4 allow,
 * written out by hand so the test does not just mirror the implementation.
 */
const ALLOWED = new Set([
  // PRD #3: invite from Uninvited or Declined
  'uninvited/not_started/invite',
  'declined/not_started/invite',
  // PRD #3: accept from Invited or Cancelled with attendance Not started
  'invited/not_started/accept',
  'cancelled/not_started/accept',
  // PRD #3: decline only from Invited
  'invited/not_started/decline',
  // PRD #3: cancel from Accepted before check-in
  'accepted/not_started/cancel',
  // PRD #4: check in when Accepted and Not started
  'accepted/not_started/check_in',
  // PRD #4: check out only after checking in
  'accepted/checked_in/check_out',
]);

const cases = PARTICIPATIONS.flatMap((participation) =>
  ATTENDANCES.flatMap((attendance) =>
    ACTIONS.map((action) => ({
      participation,
      attendance,
      action,
      allowed: ALLOWED.has(`${participation}/${attendance}/${action}`),
    })),
  ),
);

describe('transition table', () => {
  it('covers every combination', () => {
    expect(cases).toHaveLength(PARTICIPATIONS.length * ATTENDANCES.length * ACTIONS.length);
  });

  it.each(cases)(
    '$participation / $attendance / $action → allowed: $allowed',
    ({ participation, attendance, action, allowed }) => {
      expect(canApply({ participation, attendance }, action)).toBe(allowed);
    },
  );

  it('moves to the target states the PRDs define', () => {
    expect(TRANSITIONS.invite.to).toEqual({ participation: 'invited', attendance: 'not_started' });
    expect(TRANSITIONS.accept.to).toEqual({ participation: 'accepted', attendance: 'not_started' });
    expect(TRANSITIONS.decline.to).toEqual({ participation: 'declined', attendance: 'not_started' });
    expect(TRANSITIONS.cancel.to).toEqual({ participation: 'cancelled', attendance: 'not_started' });
    expect(TRANSITIONS.check_in.to).toEqual({ participation: 'accepted', attendance: 'checked_in' });
    expect(TRANSITIONS.check_out.to).toEqual({ participation: 'accepted', attendance: 'checked_out' });
  });

  it('only accept needs capacity and only accept/cancel move acceptedCount', () => {
    for (const a of ACTIONS) {
      expect(TRANSITIONS[a].needsCapacity).toBe(a === 'accept');
      expect(TRANSITIONS[a].acceptedDelta).toBe(a === 'accept' ? 1 : a === 'cancel' ? -1 : 0);
    }
  });

  it('checked out is final', () => {
    for (const p of PARTICIPATIONS) expect(allowedActions({ participation: p, attendance: 'checked_out' })).toEqual([]);
  });
});
