import type { Counts } from '@staffing/domain';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { staffingSentence } from '../lib/staffing';
import { CATEGORIES, CATEGORY_LABEL, type StaffingCategory } from '../lib/staffingSeries';
import { Card } from './Card';
import { StaffingIcon } from './icons';

function Tile({
  label,
  value,
  of,
  selected,
  onSelect,
  onKeyDown,
}: {
  label: string;
  value: number;
  of?: number;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`rounded-2xl px-4 py-3 text-left transition-colors ${
        selected ? 'bg-primary text-primary-fg' : 'tile hover:bg-[var(--secondary-hover)]'
      }`}
    >
      <span className={`block text-xs ${selected ? 'opacity-75' : 'text-muted'}`}>{label}</span>
      <span className="mt-1 flex items-baseline gap-1">
        <span
          className="text-3xl tracking-tight tabular-nums"
          data-testid={`count-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {value}
        </span>
        {of !== undefined && (
          <span className={`text-sm ${selected ? 'opacity-75' : 'text-muted'}`}>/ {of}</span>
        )}
      </span>
    </button>
  );
}

/**
 * The shift's staffing at a glance: one sentence, then the four numbers that matter, then the
 * chart. The numbers are a single-select group: the selected one (dark) is what the chart shows.
 */
export function StaffingCard({
  counts,
  selected,
  onSelect,
  className,
  children,
}: {
  counts: Counts;
  selected: StaffingCategory;
  onSelect: (category: StaffingCategory) => void;
  className?: string;
  children?: ReactNode;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  // Arrow keys, Home and End move focus between the tiles; Enter or Space selects.
  function onKeyDown(index: number) {
    return (e: KeyboardEvent<HTMLButtonElement>) => {
      const last = CATEGORIES.length - 1;
      const to = {
        ArrowRight: Math.min(index + 1, last),
        ArrowDown: Math.min(index + 1, last),
        ArrowLeft: Math.max(index - 1, 0),
        ArrowUp: Math.max(index - 1, 0),
        Home: 0,
        End: last,
      }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      groupRef.current?.querySelectorAll('button')[to]?.focus();
    };
  }

  return (
    <Card
      icon={<StaffingIcon />}
      title="Staffing"
      subtitle="Places"
      summary={staffingSentence(counts)}
      className={className}
    >
      <div
        ref={groupRef}
        role="group"
        aria-label="Shift summary"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {CATEGORIES.map((c, i) => (
          <Tile
            key={c}
            label={CATEGORY_LABEL[c]}
            value={counts[c]}
            of={c === 'filled' ? counts.required : undefined}
            selected={selected === c}
            onSelect={() => onSelect(c)}
            onKeyDown={onKeyDown(i)}
          />
        ))}
      </div>
      {children}
    </Card>
  );
}
