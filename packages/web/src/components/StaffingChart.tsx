import type { ShiftEventMessage } from '@staffing/domain';
import { useId } from 'react';
import { buildSeries, CATEGORY_LABEL, type SeriesPoint, type StaffingCategory } from '../lib/staffingSeries';
import { yTicks } from '../lib/ticks';
import { formatTime } from '../lib/time';

// Drawing area in viewBox units; the SVG scales uniformly to the card's width.
const W = 320;
const H = 120;
const LEFT = 22; // room for 2-digit y labels
const TOP = 8;
const BOTTOM = 20; // x labels
const PLOT_H = H - TOP - BOTTOM;
/** Share of the width kept for the dotted projection to the target. */
const PROJECTION = 0.18;

/** "Checked in went from 0 to 2 between 3:01 p.m. and 3:05 p.m." */
export function describeSeries(
  category: StaffingCategory,
  points: readonly SeriesPoint[],
  required: number,
  timeZone: string,
): string {
  if (points.length === 0) return 'No changes yet.';
  const label = CATEGORY_LABEL[category];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const t0 = formatTime(first.at, timeZone);
  const t1 = formatTime(last.at, timeZone);
  const when = t0 === t1 ? `at ${t0}` : `between ${t0} and ${t1}`;
  const moved =
    first.value === last.value
      ? `${label} was back at ${last.value} ${when}`
      : `${label} went from ${first.value} to ${last.value} ${when}`;
  const sentence = moved.endsWith('.') ? moved : `${moved}.`; // "… p.m." already ends in one
  return category === 'filled' && last.value >= required ? `${sentence} All places filled.` : sentence;
}

/** Where the dotted line heads: up to the required count for Filled, down to 0 for Remaining. */
function targetOf(category: StaffingCategory, required: number): number | null {
  if (category === 'filled') return required;
  if (category === 'remaining') return 0;
  return null;
}

/**
 * "<Category> over time": a thin step line of the selected count built from the event log, a dot
 * at the latest point, a dotted line from there to the target (when the category has one), and
 * every Y value labelled with a faint gridline. Plain SVG.
 */
export function StaffingChart({
  category,
  events,
  current,
  required,
  timeZone,
}: {
  category: StaffingCategory;
  events: readonly ShiftEventMessage[];
  /** The selected count as derived from the rows on screen. */
  current: number;
  required: number;
  timeZone: string;
}) {
  const captionId = useId();
  const points = buildSeries(category, events, current, required);
  const empty = points.length === 0;
  const last = empty ? { at: '', value: current } : points[points.length - 1]!;
  const target = targetOf(category, required);
  const projecting = target !== null && last.value !== target;

  const plotRight = W - (projecting ? W * PROJECTION : 4);
  const top = Math.max(required, current, ...points.map((p) => p.value), 1);
  const y = (v: number) => TOP + PLOT_H - (v / top) * PLOT_H;

  let path: string;
  const dotX = plotRight;
  if (empty) {
    path = `M ${LEFT} ${y(current)} H ${plotRight}`;
  } else {
    const t0 = Date.parse(points[0]!.at);
    const span = Date.parse(last.at) - t0;
    // All changes at the same moment: draw the step across the whole width.
    const x = (p: SeriesPoint, i: number) =>
      span > 0 ? LEFT + ((Date.parse(p.at) - t0) / span) * (plotRight - LEFT) : i === 0 ? LEFT : plotRight;
    path = points.reduce(
      (d, p, i) => (i === 0 ? `M ${x(p, i)} ${y(p.value)}` : `${d} H ${x(p, i)} V ${y(p.value)}`),
      '',
    );
    if (span > 0) path += ` H ${plotRight}`;
  }

  const label = CATEGORY_LABEL[category];
  const text = describeSeries(category, points, required, timeZone);
  return (
    <figure aria-labelledby={captionId} className="mt-5">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold" data-testid="chart-title">
          {label} over time
        </span>
        <span className="text-muted">of {required} places</span>
      </div>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full overflow-visible text-fg"
      >
        {/* Every Y value labelled, with a faint gridline (the baseline a little stronger). */}
        {yTicks(top).map((t) => (
          <g key={t} data-testid="y-tick">
            <line
              x1={LEFT}
              x2={W - 4}
              y1={y(t)}
              y2={y(t)}
              className="stroke-track"
              strokeWidth={1}
              opacity={t === 0 ? 1 : 0.55}
            />
            <text x={LEFT - 6} y={y(t) + 3} textAnchor="end" className="fill-muted tabular-nums" fontSize={9}>
              {t}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" />
        {projecting && (
          <line
            data-testid="chart-projection"
            x1={dotX}
            y1={y(last.value)}
            x2={W - 4}
            y2={y(target)}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="1 4"
            strokeLinecap="round"
            opacity={0.6}
          />
        )}
        <circle cx={dotX} cy={y(last.value)} r={4} fill="currentColor" />

        {!empty && (
          <>
            <text x={LEFT} y={H - 4} className="fill-muted" fontSize={9}>
              {formatTime(points[0]!.at, timeZone)}
            </text>
            <text x={plotRight} y={H - 4} textAnchor="end" className="fill-muted" fontSize={9}>
              {formatTime(last.at, timeZone)}
            </text>
          </>
        )}
      </svg>
      <figcaption id={captionId} data-testid="chart-text" className="mt-1 text-xs text-muted">
        {text}
      </figcaption>
    </figure>
  );
}
