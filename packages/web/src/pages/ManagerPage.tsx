import { canApply, deriveCounts, type Snapshot } from '@staffing/domain';
import { ActionButtons } from '../components/ActionButtons';
import { ActivityCard, ActivityTimeline } from '../components/ActivityTimeline';
import { useState } from 'react';
import { QueryState } from '../components/QueryState';
import { ShiftDetails } from '../components/ShiftDetails';
import { StaffingCard } from '../components/StaffingCard';
import { StaffingChart } from '../components/StaffingChart';
import { WorkerCard } from '../components/WorkerCard';
import type { StaffingCategory } from '../lib/staffingSeries';
import { useSnapshot } from '../lib/useSnapshot';
import { useTimeline } from '../lib/useTimeline';

const MANAGER_ACTIONS = ['invite'] as const;

/** Wide where there's room: two columns on tablets, the full row on desktops. */
const WIDE = 'md:col-span-2 lg:col-span-3';

/**
 * Activity: the full-width last card below xl; from xl a sticky rail on the right whose height is
 * capped to the viewport, so its list scrolls inside it. The same classes serve loading and error.
 */
const RAIL = `${WIDE} xl:col-span-1 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]`;

type TimelineQuery = ReturnType<typeof useTimeline>;

function Timeline({ snapshot, query }: { snapshot: Snapshot; query: TimelineQuery }) {
  if (query.isPending || query.isError) {
    return (
      <ActivityCard className={RAIL}>
        <p className="text-sm text-muted">
          {query.isPending ? 'Loading activity…' : "Activity couldn't be loaded."}
        </p>
      </ActivityCard>
    );
  }
  return <ActivityTimeline events={query.data} timeZone={snapshot.shift.timezone} className={RAIL} />;
}

function Dashboard({ snapshot }: { snapshot: Snapshot }) {
  const { shift, workers } = snapshot;
  // Counts are always derived from the rows on screen, never taken from the server.
  const counts = deriveCounts(workers, shift.required);
  // One event list for the chart and the Activity card: the log's end plus live and caught-up events.
  const timeline = useTimeline(snapshot);
  // Which tile the chart shows; not remembered, so every load starts on Filled.
  const [category, setCategory] = useState<StaffingCategory>('filled');

  return (
    // One column on phones, two from tablet width, three on desktops; from xl the cards keep
    // three columns and Activity moves into a fixed-width rail on the right.
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      {/* `contents` below xl, so these cards and Activity share one grid; its own grid from xl. */}
      <div className="contents xl:grid xl:grid-cols-3 xl:gap-4">
        {/* The numbers that matter most come first. */}
        <StaffingCard counts={counts} selected={category} onSelect={setCategory} className="md:col-span-2">
          {timeline.data && (
            <StaffingChart
              category={category}
              events={timeline.data}
              current={counts[category]}
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
              tinted
              footer={
                MANAGER_ACTIONS.some((a) => canApply(w, a)) ? (
                  <ActionButtons worker={w} actions={MANAGER_ACTIONS} />
                ) : undefined
              }
            />
          ))}
        </section>
      </div>

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
