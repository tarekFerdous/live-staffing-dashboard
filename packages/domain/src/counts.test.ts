import { describe, expect, it } from 'vitest';
import { deriveCounts } from './counts';
import type { Attendance, Participation } from './statuses';

const w = (participation: Participation, attendance: Attendance = 'not_started') => ({
  participation,
  attendance,
});

describe('deriveCounts', () => {
  it.each([
    {
      name: 'empty list',
      rows: [],
      required: 3,
      expected: { required: 3, filled: 0, remaining: 3, checkedIn: 0, checkedOut: 0 },
    },
    {
      name: 'all uninvited',
      rows: [w('uninvited'), w('uninvited'), w('uninvited')],
      required: 3,
      expected: { required: 3, filled: 0, remaining: 3, checkedIn: 0, checkedOut: 0 },
    },
    {
      name: 'mixed list',
      rows: [w('invited'), w('accepted'), w('declined'), w('cancelled'), w('accepted', 'checked_in')],
      required: 3,
      expected: { required: 3, filled: 2, remaining: 1, checkedIn: 1, checkedOut: 0 },
    },
    {
      name: 'full list with checked in and checked out workers counted as filled',
      rows: [w('accepted'), w('accepted', 'checked_in'), w('accepted', 'checked_out')],
      required: 3,
      expected: { required: 3, filled: 3, remaining: 0, checkedIn: 1, checkedOut: 1 },
    },
    {
      name: 'remaining never goes below zero',
      rows: [w('accepted'), w('accepted'), w('accepted')],
      required: 2,
      expected: { required: 2, filled: 3, remaining: 0, checkedIn: 0, checkedOut: 0 },
    },
  ])('$name', ({ rows, required, expected }) => {
    expect(deriveCounts(rows, required)).toEqual(expected);
  });
});
