import { useLive, type LiveStatus } from '../lib/live';

const PILL: Record<LiveStatus, { label: string; dot: string; style: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500', style: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  connecting: {
    label: 'Connecting…',
    dot: 'bg-slate-400',
    style: 'bg-slate-50 text-slate-700 border-slate-200',
  },
  reconnecting: {
    label: 'Reconnecting…',
    dot: 'bg-amber-500',
    style: 'bg-amber-50 text-amber-900 border-amber-200',
  },
  offline: { label: 'Offline', dot: 'bg-rose-500', style: 'bg-rose-50 text-rose-800 border-rose-200' },
  off: {
    label: 'Live updates off',
    dot: 'bg-slate-300',
    style: 'bg-slate-50 text-slate-600 border-slate-200',
  },
};

/** Header controls: connection pill, latency of the last live event, and the outage switch. */
export function LiveStatusBar() {
  const live = useLive();
  const pill = PILL[live.status];
  return (
    <div className="flex items-center gap-2">
      {live.latencyMs !== null && live.status === 'live' && (
        <span
          data-testid="latency-badge"
          title="Approximate: compares the server's clock with this browser's clock"
          className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600"
        >
          Last update ≈ {Math.round(live.latencyMs)} ms (approx.)
        </span>
      )}
      <span
        role="status"
        aria-label={`Connection: ${pill.label}`}
        data-testid="connection-pill"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${pill.style}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${pill.dot}`} />
        {pill.label}
      </span>
      {live.enabled && (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <button
            type="button"
            role="switch"
            aria-checked={live.outage}
            onClick={() => live.setOutage(!live.outage)}
            className={`relative h-4 w-7 rounded-full transition-colors ${live.outage ? 'bg-rose-600' : 'bg-slate-300'}`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${live.outage ? 'left-3.5' : 'left-0.5'}`}
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
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900"
    >
      {text}
    </div>
  );
}
