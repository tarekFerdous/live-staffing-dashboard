import type { Attendance, Participation } from './statuses';

export const ACTIONS = ['invite', 'accept', 'decline', 'cancel', 'check_in', 'check_out'] as const;
export type Action = (typeof ACTIONS)[number];

export type WorkerState = { participation: Participation; attendance: Attendance };

export type Transition = {
  /** States the action may start from. */
  from: readonly WorkerState[];
  /** State the worker ends in. */
  to: WorkerState;
  /** Timestamp field the action records, if any. */
  sets: 'invitedAt' | 'respondedAt' | 'checkedInAt' | 'checkedOutAt' | null;
  /** Change to the shift's stored acceptedCount. */
  acceptedDelta: -1 | 0 | 1;
  /** Whether the action needs a free place (acceptedCount < required). */
  needsCapacity: boolean;
  /** Who performs the action. */
  actor: 'manager' | 'worker';
};

const s = (participation: Participation, attendance: Attendance): WorkerState => ({ participation, attendance });

/**
 * The full state machine as data. Capacity is not part of the state, so `accept`
 * being allowed here still requires `acceptedCount < required` at write time.
 */
export const TRANSITIONS: Record<Action, Transition> = {
  invite: {
    from: [s('uninvited', 'not_started'), s('declined', 'not_started')],
    to: s('invited', 'not_started'),
    sets: 'invitedAt',
    acceptedDelta: 0,
    needsCapacity: false,
    actor: 'manager',
  },
  accept: {
    from: [s('invited', 'not_started'), s('cancelled', 'not_started')],
    to: s('accepted', 'not_started'),
    sets: 'respondedAt',
    acceptedDelta: 1,
    needsCapacity: true,
    actor: 'worker',
  },
  decline: {
    from: [s('invited', 'not_started')],
    to: s('declined', 'not_started'),
    sets: 'respondedAt',
    acceptedDelta: 0,
    needsCapacity: false,
    actor: 'worker',
  },
  cancel: {
    from: [s('accepted', 'not_started')],
    to: s('cancelled', 'not_started'),
    sets: null,
    acceptedDelta: -1,
    needsCapacity: false,
    actor: 'worker',
  },
  check_in: {
    from: [s('accepted', 'not_started')],
    to: s('accepted', 'checked_in'),
    sets: 'checkedInAt',
    acceptedDelta: 0,
    needsCapacity: false,
    actor: 'worker',
  },
  check_out: {
    from: [s('accepted', 'checked_in')],
    to: s('accepted', 'checked_out'),
    sets: 'checkedOutAt',
    acceptedDelta: 0,
    needsCapacity: false,
    actor: 'worker',
  },
};

export function canApply(state: WorkerState, action: Action): boolean {
  return TRANSITIONS[action].from.some(
    (f) => f.participation === state.participation && f.attendance === state.attendance,
  );
}

export function allowedActions(state: WorkerState): Action[] {
  return ACTIONS.filter((a) => canApply(state, a));
}
