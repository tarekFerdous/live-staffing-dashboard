import { canApply, type Participation, type Snapshot, type WorkerState } from '@staffing/domain';
import { useState } from 'react';
import { ActionButtons } from '../components/ActionButtons';
import { QueryState } from '../components/QueryState';
import { ShiftDetails } from '../components/ShiftDetails';
import { Card } from '../components/Card';
import { WorkerIcon } from '../components/icons';
import { WorkerCard } from '../components/WorkerCard';
import { readStorage, writeStorage } from '../lib/storage';
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
  return w.attendance === 'checked_out'
    ? "You've checked out. This shift is complete."
    : NO_ACTION_HINT[w.participation];
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
    <div className="grid gap-4 md:grid-cols-2">
      <Card icon={<WorkerIcon />} title="Worker" subtitle="Choose your name">
        <label htmlFor="worker-select" className="mb-2 block text-sm font-semibold">
          Who are you?
        </label>
        <select
          id="worker-select"
          value={me ? me.id : ''}
          onChange={(e) => choose(e.target.value)}
          className="w-full rounded-full bg-surface px-4 py-2.5 font-medium text-fg shadow-sm"
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
        {!me && <p className="mt-3 text-sm text-muted">Choose your name to see your status.</p>}
      </Card>

      {me && (
        <WorkerCard
          worker={me}
          timeZone={shift.timezone}
          title={`${me.name}, your status`}
          testIdPrefix="my"
          footer={
            WORKER_ACTIONS.some((a) => canApply(me, a)) ? (
              <ActionButtons key={me.id} worker={me} actions={WORKER_ACTIONS} optimistic />
            ) : (
              <p className="text-center text-sm text-muted">{noActionHint(me)}</p>
            )
          }
        />
      )}

      <div className="md:col-span-2">
        <ShiftDetails shift={shift} />
      </div>
    </div>
  );
}

export function WorkerPage() {
  const query = useSnapshot();
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">My shift</h1>
      <QueryState query={query}>{(snapshot) => <WorkerView snapshot={snapshot} />}</QueryState>
    </>
  );
}
