import { deriveCounts, type Snapshot } from '@staffing/domain';
import { ActionButtons } from '../components/ActionButtons';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { QueryState } from '../components/QueryState';
import { ShiftDetails } from '../components/ShiftDetails';
import { AttendanceBadge, ParticipationBadge } from '../components/StatusBadge';
import { formatTime } from '../lib/time';
import { useSnapshot } from '../lib/useSnapshot';
import { useTimeline } from '../lib/useTimeline';

const MANAGER_ACTIONS = ['invite'] as const;

function Timeline({ snapshot }: { snapshot: Snapshot }) {
  const query = useTimeline(snapshot);
  if (query.isPending) return <p className="text-sm text-muted">Loading activity…</p>;
  if (query.isError) return <p className="text-sm text-muted">Activity couldn't be loaded.</p>;
  return <ActivityTimeline events={query.data} timeZone={snapshot.shift.timezone} />;
}

function Count({
  label,
  value,
  of,
  emphasis,
}: {
  label: string;
  value: number;
  of?: number;
  emphasis?: boolean;
}) {
  return (
    <div className={`card p-4 ${emphasis ? 'border-accent' : ''}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span
          className="text-3xl font-bold tabular-nums"
          data-testid={`count-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {value}
        </span>
        {of !== undefined && <span className="text-sm text-muted">of {of}</span>}
      </dd>
    </div>
  );
}

const COLUMNS = ['Participation', 'Attendance', 'Invited', 'Responded', 'Checked in', 'Checked out'] as const;

function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const { shift, workers } = snapshot;
  // Counts are always derived from the rows on screen, never taken from the server.
  const counts = deriveCounts(workers, shift.required);
  const time = (iso: string | null) => (iso ? formatTime(iso, shift.timezone) : '—');

  return (
    <div className="space-y-6">
      {/* The numbers that matter most come first. */}
      <dl aria-label="Shift summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Filled" value={counts.filled} of={counts.required} emphasis />
        <Count label="Remaining" value={counts.remaining} />
        <Count label="Checked in" value={counts.checkedIn} />
        <Count label="Checked out" value={counts.checkedOut} />
      </dl>

      <ShiftDetails shift={shift} />

      <section aria-labelledby="workers-title" className="card overflow-hidden">
        <h2 id="workers-title" className="px-4 pt-4 text-lg font-semibold">
          Workers
        </h2>
        <table className="responsive-table mt-3 w-full text-left text-sm">
          <caption className="sr-only">Workers</caption>
          <thead className="border-y border-border bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">
                Worker
              </th>
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-semibold">
                  {c}
                </th>
              ))}
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {workers.map((w) => (
              <tr key={w.id}>
                <th scope="row" className="px-4 py-3 font-semibold">
                  {w.name}
                </th>
                <td data-label="Participation" className="px-3 py-3">
                  <ParticipationBadge value={w.participation} />
                </td>
                <td data-label="Attendance" className="px-3 py-3">
                  <AttendanceBadge value={w.attendance} />
                </td>
                <td data-label="Invited" className="px-3 py-3 tabular-nums">
                  {time(w.invitedAt)}
                </td>
                <td data-label="Responded" className="px-3 py-3 tabular-nums">
                  {time(w.respondedAt)}
                </td>
                <td data-label="Checked in" className="px-3 py-3 tabular-nums">
                  {time(w.checkedInAt)}
                </td>
                <td data-label="Checked out" className="px-3 py-3 tabular-nums">
                  {time(w.checkedOutAt)}
                </td>
                <td data-wide className="px-4 py-3 text-right">
                  <ActionButtons worker={w} actions={MANAGER_ACTIONS} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Timeline snapshot={snapshot} />
    </div>
  );
}

export function ManagerPage() {
  const query = useSnapshot();
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Manager dashboard</h1>
      <QueryState query={query}>{(snapshot) => <Dashboard snapshot={snapshot} />}</QueryState>
    </>
  );
}
