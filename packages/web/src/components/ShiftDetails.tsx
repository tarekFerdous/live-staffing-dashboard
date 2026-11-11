import type { Shift } from '@staffing/domain';
import { formatDate, formatTime, zoneName } from '../lib/time';

export function ShiftDetails({ shift }: { shift: Shift }) {
  const tz = shift.timezone;
  return (
    <section aria-labelledby="shift-title" className="card p-4">
      <h2 id="shift-title" className="text-lg font-semibold">
        {shift.title}
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
        <dt className="text-muted">Date</dt>
        <dd data-testid="shift-date">{formatDate(shift.startsAt, tz)}</dd>
        <dt className="text-muted">Time</dt>
        <dd data-testid="shift-time">
          {formatTime(shift.startsAt, tz)} – {formatTime(shift.endsAt, tz)} {zoneName(shift.startsAt, tz)}
        </dd>
        <dt className="text-muted">Location</dt>
        <dd>{shift.location}</dd>
        <dt className="text-muted">Places</dt>
        <dd>{shift.required}</dd>
      </dl>
    </section>
  );
}
