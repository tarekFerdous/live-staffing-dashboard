import { canApply, type Participation, type Snapshot, type WorkerState } from '@staffing/domain';
import { useState } from 'react';
import { ActionButtons } from '../components/ActionButtons';
import { QueryState } from '../components/QueryState';
import { ShiftDetails } from '../components/ShiftDetails';
import { AttendanceBadge, ParticipationBadge } from '../components/StatusBadge';
import { readStorage, writeStorage } from '../lib/storage';
import { formatTime } from '../lib/time';
import { useSnapshot } from '../lib/useSnapshot';

export const WORKER_STORAGE_KEY = 'live-staffing.workerId';

const WORKER_ACTIONS = ['accept', 'decline', 'check_in', 'check_out', 'cancel'] as const;

const NO_ACTION_HINT: Record<Participation, string> = {
  uninvited: "You haven't been invited to this shift yet.",
  invited: '',
  accepted: "You're on this shift.",
  declined: 'You declined this shift. The manager can invite you again.',
  cancelled: '',
};

function noActionHint(w: WorkerState): string {
  return w.attendance === 'checked_out' ? "You've checked out. This shift is complete." : NO_ACTION_HINT[w.participation];
}

function WorkerView({ snapshot }: { snapshot: Snapshot }) {
  const { shift, workers } = snapshot;
  const [workerId, setWorkerId] = useState<string>(() => readStorage(WORKER_STORAGE_KEY) ?? '');
  const me = workers.find((w) => w.id === workerId);

  function choose(id: string) {
    setWorkerId(id);
    writeStorage(WORKER_STORAGE_KEY, id);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label htmlFor="worker-select" className="block text-sm font-medium text-slate-700">
          Who are you?
        </label>
        <select
          id="worker-select"
          value={me ? me.id : ''}
          onChange={(e) => choose(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 sm:w-72"
        >
          <option value="" disabled>
            Choose your name…
          </option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <ShiftDetails shift={shift} />

      {me ? (
        <section aria-labelledby="my-status" className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 id="my-status" className="text-lg font-semibold">
            {me.name}, your status
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Participation</dt>
            <dd data-testid="my-participation">
              <ParticipationBadge value={me.participation} />
            </dd>
            <dt className="text-slate-500">Attendance</dt>
            <dd data-testid="my-attendance">
              <AttendanceBadge value={me.attendance} />
            </dd>
            {me.checkedInAt && (
              <>
                <dt className="text-slate-500">Checked in</dt>
                <dd>{formatTime(me.checkedInAt, shift.timezone)}</dd>
              </>
            )}
            {me.checkedOutAt && (
              <>
                <dt className="text-slate-500">Checked out</dt>
                <dd>{formatTime(me.checkedOutAt, shift.timezone)}</dd>
              </>
            )}
          </dl>
          <div className="mt-4">
            {WORKER_ACTIONS.some((a) => canApply(me, a)) ? (
              <ActionButtons key={me.id} worker={me} actions={WORKER_ACTIONS} />
            ) : (
              <p className="text-sm text-slate-600">{noActionHint(me)}</p>
            )}
          </div>
        </section>
      ) : (
        <p className="text-slate-600">Choose your name to see your status.</p>
      )}
    </div>
  );
}

export function WorkerPage() {
  const query = useSnapshot();
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">My shift</h1>
      <QueryState query={query}>{(snapshot) => <WorkerView snapshot={snapshot} />}</QueryState>
    </>
  );
}
