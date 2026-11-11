import { useLive, type LiveStatus } from '../lib/live';

// The dot carries the colour (green Live, amber reconnecting, red offline); the text says it too.
const PILL: Record<LiveStatus, { label: string; style: string }> = {
  live: { label: 'Live', style: 'pill-live' },
  connecting: { label: 'Connecting…', style: '' },
  reconnecting: { label: 'Reconnecting…', style: 'pill-warn' },
  offline: { label: 'Offline', style: 'pill-bad' },
  off: { label: 'Live updates off', style: '' },
};

/** Header controls: connection pill, latency of the last live event, and the outage switch. */
export function LiveStatusBar() {
  const live = useLive();
  const pill = PILL[live.status];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        role="status"
        aria-label={`Connection: ${pill.label}`}
        data-testid="connection-pill"
        className={`pill ${pill.style}`}
      >
        {pill.label}
      </span>
      {live.latencyMs !== null && live.status === 'live' && (
        <span
          data-testid="latency-badge"
          title="Approximate: compares the server's clock with this browser's clock"
          className="text-xs text-muted tabular-nums"
        >
          Last update ≈ {Math.round(live.latencyMs)} ms (approx.)
        </span>
      )}
      {live.enabled && (
        <label className="flex cursor-pointer items-center gap-2 rounded-full bg-secondary py-1 pr-3 pl-1 text-xs font-semibold">
          <button
            type="button"
            role="switch"
            aria-checked={live.outage}
            onClick={() => live.setOutage(!live.outage)}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${live.outage ? 'bg-bad' : 'bg-track'}`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${live.outage ? 'left-[1.125rem]' : 'left-0.5'}`}
            />
          </button>
          Simulate outage
        </label>
      )}
    </div>
  );
}

export const PAUSED_NOTICE_ID = 'live-paused-notice';

/** Full-width side gutters, shared by the header, the paused notice and the main content so their edges line up. */
export const GUTTER = 'px-4 sm:px-6 lg:px-8';

/** Why actions are off, shown once under the header instead of on every row. */
export function LivePausedNotice() {
  const live = useLive();
  if (live.canAct || live.status === 'connecting') return null;
  const text =
    live.status === 'offline'
      ? "You're offline. Actions are turned off until your connection is back."
      : 'Live updates are paused while we reconnect. Actions are turned off so nothing is sent from an out-of-date screen.';
  return (
    <div id={PAUSED_NOTICE_ID} className={`mt-2 ${GUTTER}`}>
      <p className="rounded-2xl bg-warn-bg px-4 py-2 text-center text-sm font-medium text-warn-fg">{text}</p>
    </div>
  );
}
