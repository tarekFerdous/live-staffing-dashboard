import { TRANSITIONS, type Action, type ShiftEventMessage } from '@staffing/domain';
import type { ReactNode } from 'react';
import { Card } from './Card';
import { ActivityIcon } from './icons';
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

/**
 * The Activity card's shell, also used for its loading and error states. When the card's height
 * is capped (the sticky rail on wide screens), the body shrinks and the list scrolls inside it.
 */
export function ActivityCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Card
      icon={<ActivityIcon />}
      title="Activity"
      subtitle="Live timeline"
      className={className}
      bodyClassName="flex min-h-0 flex-col"
    >
      {children}
    </Card>
  );
}

/** Recent changes, newest first, times in the shift's timezone. */
export function ActivityTimeline({
  events,
  timeZone,
  className,
}: {
  events: readonly ShiftEventMessage[];
  timeZone: string;
  className?: string;
}) {
  const newestFirst = [...events].sort((a, b) => b.seq - a.seq).slice(0, TIMELINE_LIMIT);
  return (
    <ActivityCard className={className}>
      {newestFirst.length === 0 ? (
        <p className="text-sm text-muted">No activity yet.</p>
      ) : (
        // Focusable so keyboard users can scroll it when it overflows.
        <ol
          aria-label="Activity, newest first"
          tabIndex={0}
          className="min-h-0 divide-y divide-border overflow-y-auto rounded-lg"
          data-testid="timeline"
        >
          {newestFirst.map((e) => {
            const actor = TRANSITIONS[e.type].actor;
            return (
              <li key={e.seq} className="flex items-baseline gap-3 py-2 text-sm first:pt-0 last:pb-0">
                <time dateTime={e.at} className="w-20 shrink-0 text-muted tabular-nums">
                  {formatTime(e.at, timeZone)}
                </time>
                <span className="min-w-0 flex-1">{describeEvent(e)}</span>
                <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted">
                  {actor === 'manager' ? 'Manager' : 'Worker'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </ActivityCard>
  );
}
