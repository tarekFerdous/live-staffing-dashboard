import { TRANSITIONS, type Action, type ShiftEventMessage } from '@staffing/domain';
import { formatTime } from '../lib/time';
import { TIMELINE_LIMIT } from '../lib/useTimeline';

const VERB: Record<Action, string> = {
  invite: 'invited',
  accept: 'accepted',
  decline: 'declined',
  cancel: 'cancelled',
  check_in: 'checked in',
  check_out: 'checked out',
};

/** "Manager invited Amara Okafor" / "Amara Okafor checked in": who did what to whom. */
export function describeEvent(e: ShiftEventMessage): string {
  return TRANSITIONS[e.type].actor === 'manager'
    ? `Manager ${VERB[e.type]} ${e.row.name}`
    : `${e.row.name} ${VERB[e.type]}`;
}

/** Recent changes, newest first, times in the shift's timezone. */
export function ActivityTimeline({
  events,
  timeZone,
}: {
  events: readonly ShiftEventMessage[];
  timeZone: string;
}) {
  const newestFirst = [...events].sort((a, b) => b.seq - a.seq).slice(0, TIMELINE_LIMIT);
  return (
    <section aria-labelledby="activity-title" className="card p-4">
      <h2 id="activity-title" className="text-lg font-semibold">
        Activity
      </h2>
      {newestFirst.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No activity yet.</p>
      ) : (
        <ol aria-label="Activity, newest first" className="mt-3 space-y-2" data-testid="timeline">
          {newestFirst.map((e) => {
            const actor = TRANSITIONS[e.type].actor;
            return (
              <li key={e.seq} className="flex items-baseline gap-3 text-sm">
                <time dateTime={e.at} className="w-20 shrink-0 tabular-nums text-muted">
                  {formatTime(e.at, timeZone)}
                </time>
                <span className="min-w-0 flex-1">{describeEvent(e)}</span>
                <span className="shrink-0 text-xs uppercase tracking-wide text-muted">
                  {actor === 'manager' ? 'Manager' : 'Worker'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
