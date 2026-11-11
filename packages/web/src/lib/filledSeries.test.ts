import type { ShiftEventMessage } from '@staffing/domain';
import { describe, expect, it } from 'vitest';
import { worker } from '../test/render';
import { buildFilledSeries } from './filledSeries';

const ev = (seq: number, type: ShiftEventMessage['type'], minute: number): ShiftEventMessage => ({
  seq,
  type,
  workerId: 'amara',
  row: worker('amara', 'Amara Okafor'),
  at: `2026-12-12T20:${String(minute).padStart(2, '0')}:00.000Z`,
});
const at = (minute: number) => `2026-12-12T20:${String(minute).padStart(2, '0')}:00.000Z`;

describe('buildFilledSeries', () => {
  it('is empty for an empty log', () => {
    expect(buildFilledSeries([])).toEqual([]);
    expect(buildFilledSeries([], 0)).toEqual([]);
  });

  it('steps up on accept and down on cancel, starting just before the first change', () => {
    expect(buildFilledSeries([ev(2, 'accept', 2), ev(4, 'accept', 4), ev(5, 'cancel', 5)])).toEqual([
      { at: at(2), filled: 0 },
      { at: at(2), filled: 1 },
      { at: at(4), filled: 2 },
      { at: at(5), filled: 1 },
    ]);
  });

  it('ignores invites, declines, check-ins and check-outs', () => {
    const series = buildFilledSeries([
      ev(1, 'invite', 1),
      ev(2, 'decline', 2),
      ev(3, 'accept', 3),
      ev(4, 'check_in', 4),
      ev(5, 'check_out', 5),
    ]);
    expect(series).toEqual([
      { at: at(3), filled: 0 },
      { at: at(3), filled: 1 },
    ]);
  });

  it('is only invites: no changes yet', () => {
    expect(buildFilledSeries([ev(1, 'invite', 1), ev(2, 'invite', 2)])).toEqual([]);
  });

  it('orders by seq, whatever order the events arrive in', () => {
    const series = buildFilledSeries([ev(3, 'cancel', 3), ev(1, 'accept', 1), ev(2, 'accept', 2)]);
    expect(series.map((p) => p.filled)).toEqual([0, 1, 2, 1]);
  });

  it('anchors on the current count when the events are only the end of the log', () => {
    // Two places were already filled before these events; now 2 again after +1 −1.
    const series = buildFilledSeries([ev(60, 'accept', 10), ev(61, 'cancel', 11)], 2);
    expect(series.map((p) => p.filled)).toEqual([2, 3, 2]);
  });
});
