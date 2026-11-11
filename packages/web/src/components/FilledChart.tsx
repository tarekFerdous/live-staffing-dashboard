import type { ShiftEventMessage } from '@staffing/domain';
import { useId } from 'react';
import { buildFilledSeries, type FilledPoint } from '../lib/filledSeries';
import { formatTime } from '../lib/time';

// Drawing area in viewBox units; the SVG scales uniformly to the card's width.
const W = 320;
const H = 120;
const LEFT = 16; // y labels
const TOP = 8;
const BOTTOM = 20; // x labels
const PLOT_H = H - TOP - BOTTOM;
/** Share of the width kept for the dotted projection to the required count. */
const PROJECTION = 0.18;

/** "Filled went from 0 to 2 between 3:01 p.m. and 3:05 p.m." */
export function describeFilled(points: readonly FilledPoint[], required: number, timeZone: string): string {
  if (points.length === 0) return 'No changes yet.';
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const t0 = formatTime(first.at, timeZone);
  const t1 = formatTime(last.at, timeZone);
  const when = t0 === t1 ? `at ${t0}` : `between ${t0} and ${t1}`;
  const moved =
    first.filled === last.filled
      ? `Filled was back at ${last.filled} ${when}`
      : `Filled went from ${first.filled} to ${last.filled} ${when}`;
  const sentence = moved.endsWith('.') ? moved : `${moved}.`; // "… p.m." already ends in one
  return last.filled >= required ? `${sentence} All places filled.` : sentence;
}

/**
 * "Filled over time": a thin step line of the filled count built from accept and cancel events,
 * a dot at the latest point, and a dotted line from there to the required count. Plain SVG.
 */
export function FilledChart({
  events,
  filled,
  required,
  timeZone,
}: {
  events: readonly ShiftEventMessage[];
  filled: number;
  required: number;
  timeZone: string;
}) {
  const captionId = useId();
  const points = buildFilledSeries(events, filled);
  const empty = points.length === 0;
  const last = empty ? { at: '', filled } : points[points.length - 1]!;
  const full = last.filled >= required;

  const plotRight = W - (full ? 4 : W * PROJECTION);
  const top = Math.max(required, ...points.map((p) => p.filled), 1);
  const y = (v: number) => TOP + PLOT_H - (v / top) * PLOT_H;

  let path: string;
  let dotX: number;
  if (empty) {
    path = `M ${LEFT} ${y(filled)} H ${plotRight}`;
    dotX = plotRight;
  } else {
    const t0 = Date.parse(points[0]!.at);
    const span = Date.parse(last.at) - t0;
    // All changes at the same moment: draw the step across the whole width.
    const x = (p: FilledPoint, i: number) =>
      span > 0 ? LEFT + ((Date.parse(p.at) - t0) / span) * (plotRight - LEFT) : i === 0 ? LEFT : plotRight;
    path = points.reduce(
      (d, p, i) => (i === 0 ? `M ${x(p, i)} ${y(p.filled)}` : `${d} H ${x(p, i)} V ${y(p.filled)}`),
      '',
    );
    dotX = plotRight;
    if (span > 0) path += ` H ${plotRight}`;
  }

  const text = describeFilled(points, required, timeZone);
  return (
    <figure aria-labelledby={captionId} className="mt-5">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold">Filled over time</span>
        <span className="text-muted">of {required} places</span>
      </div>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full overflow-visible text-fg"
      >
        {/* Baseline and the required level. */}
        <line x1={LEFT} x2={W - 4} y1={y(0)} y2={y(0)} className="stroke-track" strokeWidth={1} />
        <line
          x1={LEFT}
          x2={W - 4}
          y1={y(required)}
          y2={y(required)}
          className="stroke-track"
          strokeWidth={1}
        />
        <text x={0} y={y(required) + 3} className="fill-muted" fontSize={9}>
          {required}
        </text>
        <text x={0} y={y(0) + 3} className="fill-muted" fontSize={9}>
          0
        </text>

        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" />
        {!full && (
          <line
            data-testid="filled-projection"
            x1={dotX}
            y1={y(last.filled)}
            x2={W - 4}
            y2={y(required)}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="1 4"
            strokeLinecap="round"
            opacity={0.6}
          />
        )}
        <circle cx={dotX} cy={y(last.filled)} r={4} fill="currentColor" />

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
      <figcaption id={captionId} data-testid="filled-chart-text" className="mt-1 text-xs text-muted">
        {text}
      </figcaption>
    </figure>
  );
}
