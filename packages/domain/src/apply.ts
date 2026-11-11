import type { Worker } from './schemas';
import { ATTENDANCE_LABELS, PARTICIPATION_LABELS } from './statuses';
import { canApply, TRANSITIONS, type Action, type WorkerState } from './transitions';

export const ACTION_LABELS: Record<Action, string> = {
  invite: 'Invite',
  accept: 'Accept',
  decline: 'Decline',
  cancel: 'Cancel',
  check_in: 'Check in',
  check_out: 'Check out',
};

const ACTION_VERBS: Record<Action, string> = {
  invite: 'invite',
  accept: 'accept',
  decline: 'decline',
  cancel: 'cancel',
  check_in: 'check in',
  check_out: 'check out',
};

export type RejectionCode = 'INVALID_TRANSITION' | 'VERSION_CONFLICT' | 'SHIFT_FULL';

export type ApplyResult =
  /** The action changes the row. `worker` is the complete new row. */
  | { kind: 'applied'; worker: Worker; acceptedDelta: -1 | 0 | 1 }
  /** The worker is already in the action's target state: a repeat, answered with the stored row. */
  | { kind: 'already'; worker: Worker }
  | { kind: 'rejected'; code: RejectionCode; message: string; current: Worker };

export function isInTargetState(state: WorkerState, action: Action): boolean {
  const to = TRANSITIONS[action].to;
  return state.participation === to.participation && state.attendance === to.attendance;
}

function describe(w: WorkerState): string {
  return w.attendance === 'not_started'
    ? PARTICIPATION_LABELS[w.participation]
    : `${PARTICIPATION_LABELS[w.participation]} and ${ATTENDANCE_LABELS[w.attendance]}`;
}

/**
 * The single definition of what an action does to a worker row. The store
 * writes exactly the row returned here, and the property tests run it directly.
 *
 * Timestamps are only ever filled in, never overwritten: a re-invite keeps the
 * first invitedAt and a re-accept keeps the first respondedAt.
 */
export function applyAction(
  worker: Worker,
  action: Action,
  ctx: { now: string; acceptedCount: number; required: number; expectedVersion?: number },
): ApplyResult {
  // A repeat of an action that already took effect (double click, lost response).
  if (isInTargetState(worker, action)) return { kind: 'already', worker };

  // A stale view is the root cause whenever the version moved on, so say that first.
  if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== worker.version) {
    return {
      kind: 'rejected',
      code: 'VERSION_CONFLICT',
      message: `${worker.name}'s status changed since you loaded it. They are now ${describe(worker)}.`,
      current: worker,
    };
  }
  if (!canApply(worker, action)) {
    return {
      kind: 'rejected',
      code: 'INVALID_TRANSITION',
      message: `Can't ${ACTION_VERBS[action]} ${worker.name}: they are ${describe(worker)}.`,
      current: worker,
    };
  }
  const t = TRANSITIONS[action];
  if (t.needsCapacity && ctx.acceptedCount >= ctx.required) {
    return { kind: 'rejected', code: 'SHIFT_FULL', message: 'No places left', current: worker };
  }

  const next: Worker = {
    ...worker,
    participation: t.to.participation,
    attendance: t.to.attendance,
    version: worker.version + 1,
  };
  if (t.sets && next[t.sets] === null) next[t.sets] = ctx.now;
  return { kind: 'applied', worker: next, acceptedDelta: t.acceptedDelta };
}
