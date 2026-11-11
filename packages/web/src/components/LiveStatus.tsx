import { useLive, type LiveStatus } from '../lib/live';

const PILL: Record<LiveStatus, { label: string; style: string }> = {
  live: { label: 'Live', style: 'chip-ok' },
  connecting: { label: 'Connecting…', style: 'chip-neutral' },
  reconnecting: { label: 'Reconnecting…', style: 'chip-warn' },
  offline: { label: 'Offline', style: 'chip-bad' },
  off: { label: 'Live updates off', style: 'chip-neutral' },
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
        className={`chip ${pill.style}`}
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
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <button
            type="button"
            role="switch"
            aria-checked={live.outage}
            onClick={() => live.setOutage(!live.outage)}
            className={`relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors ${live.outage ? 'bg-bad-fg' : 'bg-neutral-bg'}`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-surface shadow transition-all ${live.outage ? 'left-[1.125rem]' : 'left-0.5'}`}
            />
          </button>
          Simulate outage
        </label>
      )}
    </div>
  );
}

export const PAUSED_NOTICE_ID = 'live-paused-notice';

/** Why actions are off, shown once under the header instead of on every row. */
export function LivePausedNotice() {
  const live = useLive();
  if (live.canAct || live.status === 'connecting') return null;
  const text =
    live.status === 'offline'
      ? "You're offline. Actions are turned off until your connection is back."
      : 'Live updates are paused while we reconnect. Actions are turned off so nothing is sent from an out-of-date screen.';
  return (
    <div
      id={PAUSED_NOTICE_ID}
      className="border-t border-border bg-warn-bg px-4 py-2 text-center text-sm text-warn-fg"
    >
      {text}
    </div>
  );
}
