import type { ShiftEventMessage } from '@staffing/domain';
import { describe, expect, it } from 'vitest';
import { worker } from '../test/render';
import { buildSeries } from './staffingSeries';

const ev = (seq: number, type: ShiftEventMessage['type'], minute: number): ShiftEventMessage => ({
  seq,
  type,
  workerId: 'amara',
  row: worker('amara', 'Amara Okafor'),
  at: `2026-12-12T20:${String(minute).padStart(2, '0')}:00.000Z`,
});
const at = (minute: number) => `2026-12-12T20:${String(minute).padStart(2, '0')}:00.000Z`;
const values = (points: { value: number }[]) => points.map((p) => p.value);

describe('buildSeries: filled', () => {
  it('is empty for an empty log', () => {
    expect(buildSeries('filled', [])).toEqual([]);
    expect(buildSeries('filled', [], 0)).toEqual([]);
  });

  it('steps up on accept and down on cancel, starting just before the first change', () => {
    expect(buildSeries('filled', [ev(2, 'accept', 2), ev(4, 'accept', 4), ev(5, 'cancel', 5)])).toEqual([
      { at: at(2), value: 0 },
      { at: at(2), value: 1 },
      { at: at(4), value: 2 },
      { at: at(5), value: 1 },
    ]);
  });

  it('ignores invites, declines, check-ins and check-outs', () => {
    const series = buildSeries('filled', [
      ev(1, 'invite', 1),
      ev(2, 'decline', 2),
      ev(3, 'accept', 3),
      ev(4, 'check_in', 4),
      ev(5, 'check_out', 5),
    ]);
    expect(series).toEqual([
      { at: at(3), value: 0 },
      { at: at(3), value: 1 },
    ]);
  });

  it('is only invites: no changes yet', () => {
    expect(buildSeries('filled', [ev(1, 'invite', 1), ev(2, 'invite', 2)])).toEqual([]);
  });

  it('orders by seq, whatever order the events arrive in', () => {
    const series = buildSeries('filled', [ev(3, 'cancel', 3), ev(1, 'accept', 1), ev(2, 'accept', 2)]);
    expect(values(series)).toEqual([0, 1, 2, 1]);
  });

  it('anchors on the current count when the events are only the end of the log', () => {
    // Two places were already filled before these events; now 2 again after +1 −1.
    expect(values(buildSeries('filled', [ev(60, 'accept', 10), ev(61, 'cancel', 11)], 2))).toEqual([2, 3, 2]);
  });
});

describe('buildSeries: remaining', () => {
  it('is required − filled at each point', () => {
    const series = buildSeries(
      'remaining',
      [ev(1, 'accept', 1), ev(2, 'accept', 2), ev(3, 'cancel', 3)],
      2,
      3,
    );
    expect(values(series)).toEqual([3, 2, 1, 2]);
  });

  it('anchors on the current remaining count for a partial log', () => {
    // 1 place left now; before these two accepts, 3 were left.
    expect(values(buildSeries('remaining', [ev(40, 'accept', 1), ev(41, 'accept', 2)], 1, 3))).toEqual([
      3, 2, 1,
    ]);
  });

  it('never goes below 0', () => {
    expect(values(buildSeries('remaining', [ev(1, 'accept', 1), ev(2, 'accept', 2)], 0, 1))).toEqual([
      1, 0, 0,
    ]);
  });

  it('ignores check-ins and check-outs', () => {
    expect(buildSeries('remaining', [ev(1, 'check_in', 1), ev(2, 'check_out', 2)], 3, 3)).toEqual([]);
  });
});

describe('buildSeries: checked in', () => {
  it('goes up on check-in and down on check-out (who is in now)', () => {
    const series = buildSeries('checkedIn', [
      ev(1, 'accept', 1),
      ev(2, 'check_in', 2),
      ev(3, 'check_in', 3),
      ev(4, 'check_out', 4),
    ]);
    expect(series).toEqual([
      { at: at(2), value: 0 },
      { at: at(2), value: 1 },
      { at: at(3), value: 2 },
      { at: at(4), value: 1 },
    ]);
  });

  it('anchors on the current count for a partial log and never goes below 0', () => {
    expect(values(buildSeries('checkedIn', [ev(9, 'check_out', 1)], 0))).toEqual([1, 0]);
    expect(values(buildSeries('checkedIn', [ev(9, 'check_out', 1), ev(10, 'check_out', 2)], 0))).toEqual([
      2, 1, 0,
    ]);
    expect(values(buildSeries('checkedIn', [ev(9, 'check_out', 1)]))).toEqual([0, 0]);
  });
});

describe('buildSeries: checked out', () => {
  it('only goes up, on check-out', () => {
    const series = buildSeries('checkedOut', [
      ev(1, 'check_in', 1),
      ev(2, 'check_out', 2),
      ev(3, 'check_in', 3),
      ev(4, 'check_out', 4),
    ]);
    expect(values(series)).toEqual([0, 1, 2]);
  });

  it('anchors on the current count for a partial log', () => {
    expect(values(buildSeries('checkedOut', [ev(30, 'check_out', 5)], 3))).toEqual([2, 3]);
  });
});
