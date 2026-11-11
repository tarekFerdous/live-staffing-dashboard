// Live sync for one shift. Framework-free on purpose: no React, no TanStack, no
// browser globals beyond what is injected, so every rule here is unit-tested with fakes.
import {
  ShiftEventSchema,
  type EventsPage,
  type ShiftEventMessage,
  type Snapshot,
  type Worker,
} from '@staffing/domain';

export type SyncStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export type TransportHandlers = {
  /** The subscription is confirmed; events published from now on will arrive. */
  onSubscribed(): void;
  /** One message from the channel (not yet validated). */
  onMessage(data: unknown): void;
  /** The connection ended or failed (socket closed, error, missed keep-alives). */
  onClose(reason: string): void;
};

/** A live channel. Each `connect` is one connection attempt; after `onClose` it is finished. */
export type Transport = {
  connect(channel: string, handlers: TransportHandlers): { close(): void };
};

export type SyncApi = {
  fetchEvents(shiftId: string, afterSeq: number): Promise<EventsPage>;
  fetchSnapshot(shiftId: string): Promise<Snapshot>;
};

export type SyncState = {
  status: SyncStatus;
  /** Approximate push delay of the last live event (browser clock − server clock), in ms. */
  latencyMs: number | null;
};

export type SyncOptions = {
  shiftId: string;
  transport: Transport;
  api: SyncApi;
  /** Called with every new snapshot the sync produces (write it into the query cache). */
  onSnapshot(snapshot: Snapshot): void;
  /** Called, before `onSnapshot`, for every change applied from a full event (live push or catch-up). */
  onEvent?(event: ShiftEventMessage): void;
  online?: boolean;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type ShiftSync = {
  start(): void;
  stop(): void;
  getState(): SyncState;
  subscribe(listener: () => void): () => void;
  /** Offer a snapshot read elsewhere (e.g. a refetch). Older ones are overwritten with ours. */
  adoptSnapshot(snapshot: Snapshot): void;
  /** Feed a committed change known from an API response (no latency is measured for it). */
  ingest(seq: number, row: Worker): void;
  setOnline(online: boolean): void;
  /** Simulated outage: close the connection and stop reconnecting until unblocked. */
  setBlocked(blocked: boolean): void;
};

export const channelFor = (shiftId: string) => `/shifts/${shiftId}`;

const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 5_000;

/** 250 ms, 500 ms, 1 s, 2 s, 4 s, then 5 s; each scaled by a random 0.8–1.2 and capped at 5 s. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.min(BACKOFF_CAP_MS, Math.round(base * (0.8 + 0.4 * random())));
}

function withRow(snapshot: Snapshot, seq: number, row: Worker): Snapshot {
  const exists = snapshot.workers.some((w) => w.id === row.id);
  const workers = exists
    ? snapshot.workers.map((w) => (w.id === row.id ? row : w))
    : [...snapshot.workers, row];
  const acceptedCount = workers.filter((w) => w.participation === 'accepted').length;
  return { shift: { ...snapshot.shift, acceptedCount }, workers, seq };
}

export function createShiftSync(opts: SyncOptions): ShiftSync {
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const channel = channelFor(opts.shiftId);

  let snapshot: Snapshot | null = null;
  let state: SyncState = { status: opts.online === false ? 'offline' : 'connecting', latencyMs: null };
  const listeners = new Set<() => void>();

  let started = false;
  let online = opts.online ?? true;
  let blocked = false;
  let subscribed = false;
  let connection: { close(): void } | null = null;
  /** Bumped whenever a connection ends, so late callbacks from an old one are ignored. */
  let connectionId = 0;
  let reconnectTimer: unknown = null;
  let attempt = 0;

  // Catch-up is single-flight; `maxSeen` remembers the newest seq we know exists.
  let catchingUp = false;
  let maxSeen = 0;
  let catchUpRetry: unknown = null;
  let catchUpAttempt = 0;

  function setState(next: Partial<SyncState>) {
    const merged = { ...state, ...next };
    if (merged.status === state.status && merged.latencyMs === state.latencyMs) return;
    state = merged;
    for (const l of listeners) l();
  }

  function publish(next: Snapshot) {
    snapshot = next;
    opts.onSnapshot(next);
  }

  /** Applies a change only when it is exactly the next seq. */
  function apply(seq: number, row: Worker, event?: ShiftEventMessage): 'applied' | 'old' | 'gap' {
    if (!snapshot) return 'gap';
    if (seq <= snapshot.seq) return 'old';
    if (seq > snapshot.seq + 1) return 'gap';
    if (event) opts.onEvent?.(event);
    publish(withRow(snapshot, seq, row));
    return 'applied';
  }

  function noteSeq(seq: number) {
    maxSeen = Math.max(maxSeen, seq);
  }

  function receive(seq: number, row: Worker, live?: ShiftEventMessage) {
    noteSeq(seq);
    const result = apply(seq, row, live);
    if (result === 'applied' && live) setState({ latencyMs: Math.max(0, now() - Date.parse(live.at)) });
    if (result === 'gap') void catchUp();
  }

  async function catchUp(): Promise<void> {
    if (!snapshot || !started) return;
    if (catchingUp) return;
    catchingUp = true;
    if (catchUpRetry !== null) clearTimer(catchUpRetry);
    catchUpRetry = null;
    try {
      let again = true;
      while (again && started) {
        again = false;
        const page = await opts.api.fetchEvents(opts.shiftId, snapshot!.seq);
        for (const e of page.events) {
          noteSeq(e.seq);
          apply(e.seq, e.row, e);
        }
        if (page.hasMore) {
          const fresh = await opts.api.fetchSnapshot(opts.shiftId);
          if (fresh.seq > snapshot!.seq) publish(fresh);
          again = true;
        } else if (page.events.length > 0 && snapshot!.seq < maxSeen) {
          again = true; // events arrived during the read that it did not include yet
        }
      }
      catchUpAttempt = 0;
    } catch {
      // The read failed (probably the network); try again with backoff.
      if (started) catchUpRetry = setTimer(() => void catchUp(), backoffDelay(catchUpAttempt++, random));
    } finally {
      catchingUp = false;
    }
  }

  function handleMessage(data: unknown) {
    const parsed = ShiftEventSchema.safeParse(data);
    if (!parsed.success) return; // not ours or malformed: never let it touch the screen
    receive(parsed.data.seq, parsed.data.row, parsed.data);
  }

  function connect() {
    if (!started || !online || blocked || connection) return;
    subscribed = false;
    const id = ++connectionId;
    const isCurrent = () => id === connectionId;
    // Placeholder until connect returns, so a re-entrant connect() is a no-op.
    connection = { close() {} };
    const handle = opts.transport.connect(channel, {
      onSubscribed() {
        if (!isCurrent()) return;
        subscribed = true;
        attempt = 0;
        setState({ status: 'live' });
        // Subscribed first, then read what we might have missed.
        void catchUp();
      },
      onMessage(data) {
        if (isCurrent() && subscribed) handleMessage(data);
      },
      onClose() {
        if (!isCurrent()) return;
        connectionId++;
        connection = null;
        subscribed = false;
        scheduleReconnect();
      },
    });
    // The transport may already have closed synchronously.
    if (isCurrent()) connection = handle;
  }

  function disconnect() {
    connectionId++;
    const c = connection;
    connection = null;
    subscribed = false;
    c?.close();
    if (reconnectTimer !== null) clearTimer(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (!started) return;
    if (!online) return setState({ status: 'offline' });
    setState({ status: 'reconnecting' });
    if (blocked || reconnectTimer !== null) return;
    reconnectTimer = setTimer(
      () => {
        reconnectTimer = null;
        connect();
      },
      backoffDelay(attempt++, random),
    );
  }

  return {
    start() {
      if (started) return;
      started = true;
      if (!online) return setState({ status: 'offline' });
      setState({ status: 'connecting' });
      connect();
    },
    stop() {
      started = false;
      disconnect();
      if (catchUpRetry !== null) clearTimer(catchUpRetry);
      catchUpRetry = null;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    adoptSnapshot(next) {
      if (snapshot && next.seq < snapshot.seq) return opts.onSnapshot(snapshot); // stale read: put ours back
      if (snapshot && next.seq === snapshot.seq) return;
      const first = snapshot === null;
      snapshot = next;
      noteSeq(next.seq);
      // The snapshot may have been read before we subscribed: check nothing slipped in between.
      if (first && subscribed) void catchUp();
    },
    ingest(seq, row) {
      receive(seq, row);
    },
    setOnline(next) {
      if (next === online) return;
      online = next;
      if (!started) return;
      if (!online) {
        disconnect();
        setState({ status: 'offline' });
      } else {
        attempt = 0;
        setState({ status: 'reconnecting' });
        connect();
      }
    },
    setBlocked(next) {
      if (next === blocked) return;
      blocked = next;
      if (!started) return;
      if (blocked) {
        disconnect();
        setState({ status: online ? 'reconnecting' : 'offline' });
      } else {
        attempt = 0;
        connect();
      }
    },
  };
}
