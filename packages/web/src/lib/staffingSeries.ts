import type { ShiftEventMessage } from '@staffing/domain';

/** The four Staffing tiles, named as in the domain's derived counts. */
export type StaffingCategory = 'filled' | 'remaining' | 'checkedIn' | 'checkedOut';

export const CATEGORIES: readonly StaffingCategory[] = ['filled', 'remaining', 'checkedIn', 'checkedOut'];

export const CATEGORY_LABEL: Record<StaffingCategory, string> = {
  filled: 'Filled',
  remaining: 'Remaining',
  checkedIn: 'Checked in',
  checkedOut: 'Checked out',
};

export type SeriesPoint = { at: string; value: number };

type Delta = Partial<Record<ShiftEventMessage['type'], number>>;

/**
 * Which events move each count. Remaining is derived from Filled (required − filled), so it
 * moves on the same events. Checked in counts who is in now, so a check-out takes one away.
 */
const DELTA: Record<StaffingCategory, Delta> = {
  filled: { accept: 1, cancel: -1 },
  remaining: { accept: 1, cancel: -1 }, // as filled; mapped to required − filled below
  checkedIn: { check_in: 1, check_out: -1 },
  checkedOut: { check_out: 1 },
};

/**
 * One category's count over time, one point per change, oldest first, starting with the value
 * just before the first change. Built backwards from `current` (the count derived from the
 * snapshot) so it stays right when the events are only the end of the log; without it, the
 * series starts at 0 (Remaining: at `required`). Remaining needs `required`.
 */
export function buildSeries(
  category: StaffingCategory,
  events: readonly ShiftEventMessage[],
  current?: number,
  required = 0,
): SeriesPoint[] {
  const delta = DELTA[category];
  const changes = [...events].filter((e) => delta[e.type] !== undefined).sort((a, b) => a.seq - b.seq);
  if (changes.length === 0) return [];

  const remaining = category === 'remaining';
  // Walk the underlying count (filled, for Remaining).
  const now = remaining ? (current === undefined ? undefined : required - current) : current;
  const total = changes.reduce((sum, e) => sum + delta[e.type]!, 0);
  let count = Math.max(0, (now ?? total) - total);
  const value = (n: number) => (remaining ? Math.max(0, required - n) : n);
  const points: SeriesPoint[] = [{ at: changes[0]!.at, value: value(count) }];
  for (const e of changes) {
    count = Math.max(0, count + delta[e.type]!);
    points.push({ at: e.at, value: value(count) });
  }
  return points;
}
