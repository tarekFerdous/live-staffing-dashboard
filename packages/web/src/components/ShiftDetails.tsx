import type { Shift } from '@staffing/domain';
import { formatDate, formatTime, zoneName } from '../lib/time';
import { Card } from './Card';
import { ShiftIcon } from './icons';

/** The shift like a flight card: the time range in large type, then where and when. */
export function ShiftDetails({ shift, className }: { shift: Shift; className?: string }) {
  const tz = shift.timezone;
  return (
    <Card icon={<ShiftIcon />} title={shift.title} subtitle="Shift" className={className}>
      <p data-testid="shift-time" className="text-2xl font-bold tracking-tight tabular-nums">
        <span className="whitespace-nowrap">{formatTime(shift.startsAt, tz)}</span>
        <span aria-hidden="true" className="mx-2 text-muted">
          →
        </span>
        <span className="sr-only"> to </span>
        <span className="whitespace-nowrap">{formatTime(shift.endsAt, tz)}</span>
      </p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Location</dt>
        <dd className="font-medium">{shift.location}</dd>
        <dt className="text-muted">Date</dt>
        <dd data-testid="shift-date" className="font-medium">
          {formatDate(shift.startsAt, tz)}
        </dd>
        <dt className="text-muted">Timezone</dt>
        <dd data-testid="shift-timezone" className="font-medium">
          {zoneName(shift.startsAt, tz)} ({tz.replace(/_/g, ' ')})
        </dd>
        <dt className="text-muted">Places</dt>
        <dd className="font-medium">{shift.required}</dd>
      </dl>
    </Card>
  );
}
