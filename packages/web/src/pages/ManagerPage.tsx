import { deriveCounts, type Snapshot } from '@staffing/domain';
import { ActionButtons } from '../components/ActionButtons';
import { QueryState } from '../components/QueryState';
import { ShiftDetails } from '../components/ShiftDetails';
import { AttendanceBadge, ParticipationBadge } from '../components/StatusBadge';
import { formatTime } from '../lib/time';
import { useSnapshot } from '../lib/useSnapshot';

const MANAGER_ACTIONS = ['invite'] as const;

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className="text-2xl font-semibold"
        data-testid={`count-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const { shift, workers } = snapshot;
  // Counts are always derived from the rows on screen, never taken from the server.
  const counts = deriveCounts(workers, shift.required);
  const time = (iso: string | null) => (iso ? formatTime(iso, shift.timezone) : '—');

  return (
    <div className="space-y-4">
      <ShiftDetails shift={shift} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Count label="Filled" value={counts.filled} />
        <Count label="Remaining" value={counts.remaining} />
        <Count label="Checked in" value={counts.checkedIn} />
        <Count label="Checked out" value={counts.checkedOut} />
      </dl>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Workers</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">
                Worker
              </th>
              <th scope="col" className="px-3 py-2">
                Participation
              </th>
              <th scope="col" className="px-3 py-2">
                Attendance
              </th>
              <th scope="col" className="px-3 py-2">
                Invited
              </th>
              <th scope="col" className="px-3 py-2">
                Responded
              </th>
              <th scope="col" className="px-3 py-2">
                Checked in
              </th>
              <th scope="col" className="px-3 py-2">
                Checked out
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-t border-slate-100">
                <th scope="row" className="px-3 py-2 font-medium">
                  {w.name}
                </th>
                <td className="px-3 py-2">
                  <ParticipationBadge value={w.participation} />
                </td>
                <td className="px-3 py-2">
                  <AttendanceBadge value={w.attendance} />
                </td>
                <td className="px-3 py-2">{time(w.invitedAt)}</td>
                <td className="px-3 py-2">{time(w.respondedAt)}</td>
                <td className="px-3 py-2">{time(w.checkedInAt)}</td>
                <td className="px-3 py-2">{time(w.checkedOutAt)}</td>
                <td className="px-3 py-2">
                  <ActionButtons worker={w} actions={MANAGER_ACTIONS} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ManagerPage() {
  const query = useSnapshot();
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Manager dashboard</h1>
      <QueryState query={query}>{(snapshot) => <Dashboard snapshot={snapshot} />}</QueryState>
    </>
  );
}
