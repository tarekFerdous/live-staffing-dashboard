import { deriveCounts, type Counts } from '@staffing/domain';
import { describe, expect, it } from 'vitest';
import { staffingSentence } from './staffing';

const counts = (filled: number, checkedIn = 0, checkedOut = 0, required = 3): Counts => ({
  required,
  filled,
  remaining: Math.max(0, required - filled),
  checkedIn,
  checkedOut,
});

describe('staffingSentence', () => {
  it.each([
    [counts(0), 'No places filled yet. 3 places to go.'],
    [counts(0, 0, 0, 1), 'No places filled yet. 1 place to go.'],
    [counts(1), '1 of 3 places filled. Nobody checked in yet.'],
    [counts(2, 1), '2 of 3 places filled. 1 checked in, nobody out yet.'],
    [counts(2, 1, 1), '2 of 3 places filled. 1 checked in, 1 checked out.'],
    [counts(2, 0, 1), '2 of 3 places filled. 1 checked out, nobody else checked in.'],
    [counts(3), 'All 3 places filled. Nobody checked in yet.'],
    [counts(3, 3), 'All 3 places filled. 3 checked in, nobody out yet.'],
    [counts(3, 0, 3), 'All 3 places filled. Everyone has checked out.'],
    [counts(1, 0, 0, 1), 'The place is filled. Nobody checked in yet.'],
  ])('%o → %s', (c, text) => {
    expect(staffingSentence(c)).toBe(text);
  });

  it('works from the derived counts of real rows', () => {
    const c = deriveCounts(
      [
        { participation: 'accepted', attendance: 'checked_in' },
        { participation: 'accepted', attendance: 'not_started' },
        { participation: 'declined', attendance: 'not_started' },
      ],
      3,
    );
    expect(staffingSentence(c)).toBe('2 of 3 places filled. 1 checked in, nobody out yet.');
  });
});
