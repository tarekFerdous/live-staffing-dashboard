import { ACTION_LABELS, canApply, type Action, type Worker } from '@staffing/domain';
import { useLive } from '../lib/live';
import { useWorkerAction } from '../lib/useWorkerAction';
import { PAUSED_NOTICE_ID } from './LiveStatus';

const STYLE: Partial<Record<Action, string>> = {
  invite: 'bg-slate-900 text-white hover:bg-slate-700',
  accept: 'bg-emerald-700 text-white hover:bg-emerald-800',
  decline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
  cancel: 'border border-rose-300 bg-white text-rose-800 hover:bg-rose-50',
  check_in: 'bg-sky-700 text-white hover:bg-sky-800',
  check_out: 'bg-slate-900 text-white hover:bg-slate-700',
};

/**
 * The buttons for `actions` that the transition table allows from the worker's
 * current state. Illegal actions are not shown at all; all buttons for the
 * worker are disabled while one of them is in flight (no double submits), and
 * all of them while live updates are not running (the notice under the header says why).
 */
export function ActionButtons({ worker, actions }: { worker: Worker; actions: readonly Action[] }) {
  const { run, pending, pendingAction } = useWorkerAction(worker);
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
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${pending ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'} ${STYLE[a] ?? ''}`}
        >
          {pendingAction === a ? `${ACTION_LABELS[a]}…` : ACTION_LABELS[a]}
        </button>
      ))}
    </div>
  );
}
