import type { ShiftEventMessage } from '@staffing/domain';

export type FilledPoint = { at: string; filled: number };

/** Only accepting and cancelling move the filled count (check-in and check-out don't). */
const DELTA: Partial<Record<ShiftEventMessage['type'], number>> = { accept: 1, cancel: -1 };

/**
 * The filled count over time, one point per accept or cancel, oldest first, starting with
 * the value just before the first change. Built backwards from `currentFilled` (the count
 * derived from the snapshot) so it stays right when the events are only the end of the log;
 * without it, the series starts at 0.
 */
export function buildFilledSeries(
  events: readonly ShiftEventMessage[],
  currentFilled?: number,
): FilledPoint[] {
  const changes = [...events].filter((e) => DELTA[e.type] !== undefined).sort((a, b) => a.seq - b.seq);
  if (changes.length === 0) return [];

  const total = changes.reduce((sum, e) => sum + DELTA[e.type]!, 0);
  let filled = Math.max(0, (currentFilled ?? total) - total);
  const points: FilledPoint[] = [{ at: changes[0]!.at, filled }];
  for (const e of changes) {
    filled = Math.max(0, filled + DELTA[e.type]!);
    points.push({ at: e.at, filled });
  }
  return points;
}
