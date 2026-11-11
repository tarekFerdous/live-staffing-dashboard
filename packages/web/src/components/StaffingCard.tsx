import type { Counts } from '@staffing/domain';
import type { ReactNode } from 'react';
import { staffingSentence } from '../lib/staffing';
import { Card } from './Card';
import { StaffingIcon } from './icons';

function Tile({
  label,
  value,
  of,
  emphasis = false,
}: {
  label: string;
  value: number;
  of?: number;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${emphasis ? 'bg-primary text-primary-fg' : 'tile'}`}>
      <dt className={`text-xs font-medium ${emphasis ? 'opacity-75' : 'text-muted'}`}>{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span
          className="text-3xl font-bold tracking-tight tabular-nums"
          data-testid={`count-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {value}
        </span>
        {of !== undefined && (
          <span className={`text-sm ${emphasis ? 'opacity-75' : 'text-muted'}`}>/ {of}</span>
        )}
      </dd>
    </div>
  );
}

/** The shift's staffing at a glance: one sentence, then the four numbers that matter, then the chart. */
export function StaffingCard({
  counts,
  className,
  children,
}: {
  counts: Counts;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card
      icon={<StaffingIcon />}
      title="Staffing"
      subtitle="Places"
      summary={staffingSentence(counts)}
      className={className}
    >
      <dl aria-label="Shift summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Filled" value={counts.filled} of={counts.required} emphasis />
        <Tile label="Remaining" value={counts.remaining} />
        <Tile label="Checked in" value={counts.checkedIn} />
        <Tile label="Checked out" value={counts.checkedOut} />
      </dl>
      {children}
    </Card>
  );
}
