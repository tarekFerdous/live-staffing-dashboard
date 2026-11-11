import { canApply, deriveCounts, type Snapshot } from '@staffing/domain';
import { ActionButtons } from '../components/ActionButtons';
import { ActivityCard, ActivityTimeline } from '../components/ActivityTimeline';
import { FilledChart } from '../components/FilledChart';
import { QueryState } from '../components/QueryState';
import { ShiftDetails } from '../components/ShiftDetails';
import { StaffingCard } from '../components/StaffingCard';
import { WorkerCard } from '../components/WorkerCard';
import { useSnapshot } from '../lib/useSnapshot';
import { useTimeline } from '../lib/useTimeline';

const MANAGER_ACTIONS = ['invite'] as const;

/** Wide where there's room: two columns on tablets, the full row on desktops. */
const WIDE = 'md:col-span-2 lg:col-span-3';

type TimelineQuery = ReturnType<typeof useTimeline>;

function Timeline({ snapshot, query }: { snapshot: Snapshot; query: TimelineQuery }) {
  if (query.isPending || query.isError) {
    return (
      <ActivityCard className={WIDE}>
        <p className="text-sm text-muted">
          {query.isPending ? 'Loading activity…' : "Activity couldn't be loaded."}
        </p>
      </ActivityCard>
    );
  }
  return <ActivityTimeline events={query.data} timeZone={snapshot.shift.timezone} className={WIDE} />;
}

function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const { shift, workers } = snapshot;
  // Counts are always derived from the rows on screen, never taken from the server.
  const counts = deriveCounts(workers, shift.required);
  // One event list for the chart and the Activity card: the log's end plus live and caught-up events.
  const timeline = useTimeline(snapshot);

  return (
    // One column on phones, two from tablet width, three on desktops.
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* The numbers that matter most come first. */}
      <StaffingCard counts={counts} className="md:col-span-2">
        {timeline.data && (
          <FilledChart
            events={timeline.data}
            filled={counts.filled}
            required={counts.required}
            timeZone={shift.timezone}
          />
        )}
      </StaffingCard>
      <ShiftDetails shift={shift} className="md:col-span-2 lg:col-span-1" />

      {/* `contents`: the worker cards sit in the page grid but stay a labelled group. */}
      <section aria-labelledby="workers-title" className="contents">
        <h2 id="workers-title" className="sr-only">
          Workers
        </h2>
        {workers.map((w) => (
          <WorkerCard
            key={w.id}
            worker={w}
            timeZone={shift.timezone}
            headingLevel={3}
            footer={
              MANAGER_ACTIONS.some((a) => canApply(w, a)) ? (
                <ActionButtons worker={w} actions={MANAGER_ACTIONS} />
              ) : undefined
            }
          />
        ))}
      </section>

      <Timeline snapshot={snapshot} query={timeline} />
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
