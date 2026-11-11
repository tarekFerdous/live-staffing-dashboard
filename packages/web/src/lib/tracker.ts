import type { Worker, WorkerState } from '@staffing/domain';
import { formatTime } from './time';

export const TRACKER_STEPS = ['Invited', 'Accepted', 'Checked in', 'Checked out'] as const;

export type Tracker = {
  /** Steps reached (0 = not invited yet). */
  step: 0 | 1 | 2 | 3 | 4;
  /** Set when progress stopped at `step`. */
  stopped: 'Declined' | 'Cancelled' | null;
  /** The worker's status in a word or two: "Accepted", "Declined", "Not invited". */
  label: string;
  /** The tracker as text, so it never depends on colour or position: "Step 2 of 4: Accepted". */
  text: string;
};

const of = (step: Tracker['step'], label: string, stopped: Tracker['stopped'] = null): Tracker => ({
  step,
  stopped,
  label,
  text: step === 0 ? label : `Step ${step} of ${TRACKER_STEPS.length}: ${label}`,
});

/** Where a worker is on Invited → Accepted → Checked in → Checked out. */
export function trackerFor(w: WorkerState): Tracker {
  switch (w.participation) {
    case 'uninvited':
      return of(0, 'Not invited');
    case 'invited':
      return of(1, 'Invited');
    // Declining and cancelling both stop the bar at the Accepted step.
    case 'declined':
      return of(2, 'Declined', 'Declined');
    case 'cancelled':
      return of(2, 'Cancelled', 'Cancelled');
    case 'accepted':
      if (w.attendance === 'checked_out') return of(4, 'Checked out');
      if (w.attendance === 'checked_in') return of(3, 'Checked in');
      return of(2, 'Accepted');
  }
}

/** One sentence about the latest thing that happened, in the shift's timezone: "Accepted at 3:04 p.m." */
export function workerSentence(w: Worker, timeZone: string): string {
  // "… 3:04 p.m." already ends in a full stop.
  return finish(describeLatest(w, timeZone));
}

const finish = (s: string) => (s.endsWith('.') ? s : `${s}.`);

function describeLatest(w: Worker, timeZone: string): string {
  const at = (iso: string | null) => (iso ? ` at ${formatTime(iso, timeZone)}` : '');
  switch (w.participation) {
    case 'uninvited':
      return 'Not invited yet.';
    case 'invited':
      return `Invited${at(w.invitedAt)}`;
    case 'declined':
      return `Declined${at(w.respondedAt)}`;
    // Cancelling records no time of its own; the last time on record is the acceptance.
    case 'cancelled':
      return w.respondedAt ? `Cancelled after accepting${at(w.respondedAt)}` : 'Cancelled.';
    case 'accepted':
      if (w.attendance === 'checked_out') return `Checked out${at(w.checkedOutAt)}`;
      if (w.attendance === 'checked_in') return `Checked in${at(w.checkedInAt)}`;
      return `Accepted${at(w.respondedAt)}`;
  }
}
