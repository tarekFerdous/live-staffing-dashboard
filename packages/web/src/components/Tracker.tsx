import type { WorkerState } from '@staffing/domain';
import { TRACKER_STEPS, trackerFor } from '../lib/tracker';

/**
 * A parcel-style progress bar: Invited → Accepted → Checked in → Checked out.
 * A thick solid bar fills up to the current step on a light track; a stop (Declined,
 * Cancelled) ends in muted red. The bar is decorative; the text under it says the same.
 */
export function Tracker({ worker }: { worker: WorkerState }) {
  const t = trackerFor(worker);
  const pct = (t.step / TRACKER_STEPS.length) * 100;
  return (
    <div>
      <div aria-hidden="true" className="relative h-2.5 rounded-full bg-track">
        {t.step > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          >
            {t.stopped && <span className="absolute inset-y-0 right-0 w-5 rounded-full bg-bad" />}
          </div>
        )}
      </div>
      <ol aria-hidden="true" className="mt-1.5 grid grid-cols-4 text-[11px] leading-tight text-muted">
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
