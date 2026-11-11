import { canApply, type Participation, type Snapshot, type Worker, type WorkerState } from '@staffing/domain';
import { Fragment, useState, type ReactNode } from 'react';
import { ActionButtons } from '../components/ActionButtons';
import { QueryState } from '../components/QueryState';
import { Select } from '../components/Select';
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

/** The chosen worker's name, large, then their details. */
function Profile({ worker: w }: { worker: Worker }) {
  const rows: [string, ReactNode][] = [
    ['Role', w.role],
    ['Phone', <a href={`tel:${w.phone.replace(/[^\d+]/g, '')}`}>{w.phone}</a>],
    ['Email', <a href={`mailto:${w.email}`}>{w.email}</a>],
    ['Address', w.address],
  ];
  return (
    <div className="mt-5" data-testid="my-profile">
      <h3 className="text-2xl leading-tight tracking-tight">{w.name}</h3>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium [&_a]:underline [&_a]:underline-offset-2">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
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
      {/* Raised so the open picker menu floats over the cards after it. */}
      <Card icon={<WorkerIcon />} title="Worker" subtitle="Choose your name" className="relative z-10">
        <Select
          label="Who are you?"
          placeholder="Choose your name…"
          value={me ? me.id : ''}
          options={workers.map((w) => ({ value: w.id, label: w.name }))}
          onChange={choose}
        />
        {me ? (
          <Profile worker={me} />
        ) : (
          <p className="mt-3 text-sm text-muted">Choose your name to see your status.</p>
        )}
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
      <h1 className="mb-4 text-2xl tracking-tight">My shift</h1>
      <QueryState query={query}>{(snapshot) => <WorkerView snapshot={snapshot} />}</QueryState>
    </>
  );
}
