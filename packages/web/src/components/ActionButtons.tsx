import { ACTION_LABELS, canApply, type Action, type Worker } from '@staffing/domain';
import { useLive } from '../lib/live';
import { useWorkerAction } from '../lib/useWorkerAction';
import { PAUSED_NOTICE_ID } from './LiveStatus';

const STYLE: Record<Action, string> = {
  invite: 'btn-primary',
  accept: 'btn-primary',
  decline: 'btn-secondary',
  cancel: 'btn-danger',
  check_in: 'btn-primary',
  check_out: 'btn-primary',
};

/**
 * The buttons for `actions` that the transition table allows from the worker's
 * current state. Illegal actions are not shown at all; all buttons for the
 * worker are disabled while one of them is in flight (no double submits), and
 * all of them while live updates are not running (the notice under the header says why).
 */
export function ActionButtons({
  worker,
  actions,
  optimistic = false,
}: {
  worker: Worker;
  actions: readonly Action[];
  /** Show the expected result before the server answers (the worker's own page). */
  optimistic?: boolean;
}) {
  const { run, pending, pendingAction } = useWorkerAction(worker, { optimistic });
  const { canAct } = useLive();
  const allowed = actions.filter((a) => canApply(worker, a));
  if (allowed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {allowed.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => run(a)}
          disabled={pending || !canAct}
          aria-label={`${ACTION_LABELS[a]} ${worker.name}`}
          aria-describedby={canAct ? undefined : PAUSED_NOTICE_ID}
          aria-busy={pendingAction === a || undefined}
          className={`btn ${STYLE[a]}`}
        >
          {pendingAction === a ? `${ACTION_LABELS[a]}…` : ACTION_LABELS[a]}
        </button>
      ))}
    </div>
  );
}
