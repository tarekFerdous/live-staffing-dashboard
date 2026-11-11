import type { WorkerState } from '@staffing/domain';
import { fillPercent, TRACKER_STEPS, trackerFor } from '../lib/tracker';

/**
 * A parcel-style progress bar: Invited → Accepted → Checked in → Checked out.
 * A thick solid bar fills to the centre of the current step's label (all the way once checked
 * out) on a light track, and ends in a rounded knob; a stop (Declined, Cancelled) turns the knob
 * muted red. The bar is decorative; the text under it says the same.
 */
export function Tracker({ worker }: { worker: WorkerState }) {
  const t = trackerFor(worker);
  const pct = fillPercent(t);
  return (
    <div>
      <div aria-hidden="true" className="relative h-2.5 rounded-full bg-track">
        {t.step > 0 && (
          <>
            <div
              data-testid="tracker-fill"
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
            {/* Centred on the fill's end, but never past either end of the bar. */}
            <span
              data-testid="tracker-knob"
              data-stopped={t.stopped ? 'true' : undefined}
              data-at={pct}
              className={`absolute -top-0.5 h-3.5 w-5 rounded-full transition-[left] duration-300 ${
                t.stopped ? 'bg-bad' : 'bg-primary'
              }`}
              style={{ left: `clamp(0px, calc(${pct}% - 0.625rem), calc(100% - 1.25rem))` }}
            />
          </>
        )}
      </div>
      <ol
        aria-hidden="true"
        className="mt-1.5 grid grid-cols-4 text-center text-[11px] leading-tight text-muted"
      >
        {TRACKER_STEPS.map((s, i) => (
          <li
            key={s}
            className={i < t.step && !(t.stopped && i === t.step - 1) ? 'font-semibold text-fg' : ''}
          >
            {s}
          </li>
        ))}
      </ol>
      <p data-testid="tracker" className={`mt-2 text-xs font-semibold ${t.stopped ? 'text-bad-fg' : ''}`}>
        {t.text}
      </p>
    </div>
  );
}
