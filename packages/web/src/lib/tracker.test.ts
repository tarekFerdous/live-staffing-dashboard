import { ATTENDANCES, PARTICIPATIONS, type Attendance, type Participation } from '@staffing/domain';
import { describe, expect, it } from 'vitest';
import { worker } from '../test/render';
import { trackerFor, workerSentence } from './tracker';

const TZ = 'America/Toronto';

describe('trackerFor', () => {
  // Every participation × attendance combination; the ones the rules never produce are still defined.
  const expected: Record<Participation, Partial<Record<Attendance, string>> & { any?: string }> = {
    uninvited: { any: 'Not invited' },
    invited: { any: 'Step 1 of 4: Invited' },
    declined: { any: 'Step 2 of 4: Declined' },
    cancelled: { any: 'Step 2 of 4: Cancelled' },
    accepted: {
      not_started: 'Step 2 of 4: Accepted',
      checked_in: 'Step 3 of 4: Checked in',
      checked_out: 'Step 4 of 4: Checked out',
    },
  };

  for (const participation of PARTICIPATIONS) {
    for (const attendance of ATTENDANCES) {
      const text = expected[participation][attendance] ?? expected[participation].any;
      it(`${participation} + ${attendance} → "${text}"`, () => {
        expect(trackerFor({ participation, attendance }).text).toBe(text);
      });
    }
  }

  it('stops the bar at the Accepted step for Declined and Cancelled, with their label', () => {
    expect(trackerFor({ participation: 'declined', attendance: 'not_started' })).toMatchObject({
      step: 2,
      stopped: 'Declined',
      label: 'Declined',
    });
    expect(trackerFor({ participation: 'cancelled', attendance: 'not_started' })).toMatchObject({
      step: 2,
      stopped: 'Cancelled',
    });
    expect(trackerFor({ participation: 'accepted', attendance: 'checked_in' }).stopped).toBeNull();
  });

  it('shows an empty track for a worker who is not invited', () => {
    expect(trackerFor({ participation: 'uninvited', attendance: 'not_started' })).toMatchObject({
      step: 0,
      label: 'Not invited',
    });
  });
});

describe('workerSentence', () => {
  const at = (hhmm: string) => `2026-12-12T${hhmm}:00.000Z`; // UTC; Toronto is UTC−5
  const w = (patch: Parameters<typeof worker>[2]) => worker('amara', 'Amara Okafor', patch);

  it('says what happened last and when, in the shift timezone', () => {
    expect(workerSentence(w({}), TZ)).toBe('Not invited yet.');
    expect(workerSentence(w({ participation: 'invited', invitedAt: at('20:01') }), TZ)).toBe(
      'Invited at 3:01 p.m.',
    );
    expect(
      workerSentence(w({ participation: 'accepted', invitedAt: at('20:01'), respondedAt: at('20:04') }), TZ),
    ).toBe('Accepted at 3:04 p.m.');
    expect(workerSentence(w({ participation: 'declined', respondedAt: at('20:04') }), TZ)).toBe(
      'Declined at 3:04 p.m.',
    );
    expect(workerSentence(w({ participation: 'cancelled', respondedAt: at('20:04') }), TZ)).toBe(
      'Cancelled after accepting at 3:04 p.m.',
    );
    expect(
      workerSentence(
        w({ participation: 'accepted', attendance: 'checked_in', checkedInAt: at('22:10') }),
        TZ,
      ),
    ).toBe('Checked in at 5:10 p.m.');
    expect(
      workerSentence(
        w({ participation: 'accepted', attendance: 'checked_out', checkedOutAt: at('23:59') }),
        TZ,
      ),
    ).toBe('Checked out at 6:59 p.m.');
  });
});
