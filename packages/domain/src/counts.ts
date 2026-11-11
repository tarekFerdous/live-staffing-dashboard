import type { WorkerState } from './transitions';

export type Counts = {
  required: number;
  filled: number;
  remaining: number;
  checkedIn: number;
  checkedOut: number;
};

/**
 * Derives every dashboard count from the worker rows so the numbers can never
 * disagree with the list. Accepted workers stay Accepted through check-in and
 * check-out, so they keep counting as filled.
 */
export function deriveCounts(rows: readonly WorkerState[], required: number): Counts {
  let filled = 0;
  let checkedIn = 0;
  let checkedOut = 0;
  for (const r of rows) {
    if (r.participation === 'accepted') filled++;
    if (r.attendance === 'checked_in') checkedIn++;
    if (r.attendance === 'checked_out') checkedOut++;
  }
  return { required, filled, remaining: Math.max(0, required - filled), checkedIn, checkedOut };
}
