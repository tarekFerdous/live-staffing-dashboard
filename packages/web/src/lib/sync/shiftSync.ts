// Live sync for one shift. Framework-free on purpose: no React, no TanStack, no
// browser globals beyond what is injected, so every rule here is unit-tested with fakes.
import {
  ResetMessageSchema,
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
  /**
   * `eventual` marks a routine periodic check: the server may read eventually consistently, at half
   * the cost. The answer can then lag a moment behind; the sync never lets that roll a page back.
   */
  fetchEvents(shiftId: string, afterSeq: number, opts?: { eventual?: boolean }): Promise<EventsPage>;
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
  /**
   * Called, before `onSnapshot`, when the shift was reset (a newer epoch): the page should drop
   * what it built on the old state (pending optimistic rows, the timeline).
   */
  onReset?(snapshot: Snapshot): void;
  online?: boolean;
  /** Whether the page is visible (`document.visibilityState`); a hidden page pauses (#93). */
  visible?: boolean;
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
  /**
   * A hidden tab closes its connection and makes no requests at all (#93). Visible again, it
   * starts as on first load: subscribe, then catch up on what it missed.
   */
  setVisible(visible: boolean): void;
};

export const channelFor = (shiftId: string) => `/shifts/${shiftId}`;

/**
 * A push can be lost (the channel delivers at most once). A lost event in the middle of a burst
 * shows up as a gap when the next one arrives; a lost *last* event has nothing after it. So a
 * quiet moment after live events is followed by one catch-up read, which finds it.
 */
export const VERIFY_AFTER_MS = 1_500;
/**
 * A page can also miss a push with nothing else arriving at all. While Live, it reads what it
 * missed this often regardless (one small, usually empty read), so nothing stays stale for long.
 */
export const VERIFY_EVERY_MS = 6_000;

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
  return { shift: { ...snapshot.shift, acceptedCount }, workers, seq, epoch: snapshot.epoch };
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
  let visible = opts.visible ?? true;
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

  /**
   * Where an event stands against the shift we hold: from an older epoch (drop it), a newer
   * one (we missed a reset), or ours. Events without an epoch predate epochs: treated as ours.
   */
  function epochOf(e: { epoch?: number }): 'older' | 'newer' | 'same' {
    if (!snapshot || e.epoch === undefined || e.epoch === snapshot.epoch) return 'same';
    return e.epoch < snapshot.epoch ? 'older' : 'newer';
  }

  // A reset: adopt the server's snapshot even though its seq is lower. Single-flight; only
  // ever moves forward to a newer epoch, never back.
  let resetting = false;
  let resetTarget = 0;
  let resetRetry: unknown = null;
  let resetAttempt = 0;

  function adoptReset(fresh: Snapshot) {
    snapshot = fresh;
    maxSeen = fresh.seq;
    opts.onReset?.(fresh);
    opts.onSnapshot(fresh);
  }

  async function resetTo(epoch: number): Promise<void> {
    if (!started || (snapshot && epoch <= snapshot.epoch)) return;
    resetTarget = Math.max(resetTarget, epoch);
    if (resetting) return;
    resetting = true;
    if (resetRetry !== null) clearTimer(resetRetry);
    resetRetry = null;
    try {
      const fresh = await opts.api.fetchSnapshot(opts.shiftId);
      if (!started) return;
      // Not there yet (a read racing the reset): try again shortly.
      if (fresh.epoch < resetTarget) throw new Error('snapshot older than the announced reset');
      if (!snapshot || fresh.epoch > snapshot.epoch) adoptReset(fresh);
      resetAttempt = 0;
      // Anything committed after the snapshot was read arrives live or through this catch-up.
      void catchUp();
    } catch {
      if (started) {
        resetRetry = setTimer(() => void resetTo(resetTarget), backoffDelay(resetAttempt++, random));
      }
    } finally {
      resetting = false;
    }
  }

  function receive(seq: number, row: Worker, live?: ShiftEventMessage) {
    if (live) {
      const where = epochOf(live);
      if (where === 'older') return; // a change from before a reset, delivered late
      if (where === 'newer') return void resetTo(live.epoch!);
    }
    noteSeq(seq);
    const result = apply(seq, row, live);
    if (result === 'applied' && live) setState({ latencyMs: Math.max(0, now() - Date.parse(live.at)) });
    if (result === 'gap') void catchUp();
    if (live) scheduleVerify();
  }

  // A catch-up read once a burst of live events goes quiet, and every VERIFY_EVERY_MS while
  // Live otherwise. One timer: a live event moves it closer, each read schedules the next.
  // The routine periodic check reads eventually consistently (#92); the one after a burst is
  // strong, so a page sees its own writes right away.
  let verifyTimer: unknown = null;
  function scheduleVerify(ms = VERIFY_AFTER_MS) {
    if (verifyTimer !== null) clearTimer(verifyTimer);
    verifyTimer = setTimer(() => {
      verifyTimer = null;
      if (!subscribed) return;
      void catchUp({ eventual: ms === VERIFY_EVERY_MS });
      scheduleVerify(VERIFY_EVERY_MS);
    }, ms);
  }

  /** Reads what this page missed. Strongly consistent unless `eventual` (the periodic check). */
  async function catchUp({ eventual = false } = {}): Promise<void> {
    if (!snapshot || !started || !visible) return;
    if (catchingUp) return;
    catchingUp = true;
    if (catchUpRetry !== null) clearTimer(catchUpRetry);
    catchUpRetry = null;
    try {
      let again = true;
      let lagging = eventual;
      while (again && started) {
        again = false;
        const readWasEventual = lagging;
        lagging = false; // any follow-up read is strong
        const page = await opts.api.fetchEvents(
          opts.shiftId,
          snapshot!.seq,
          readWasEventual ? { eventual: true } : undefined,
        );
        // The shift was reset since our snapshot (we missed the live message, e.g. in an outage).
        if (page.epoch > snapshot!.epoch) {
          void resetTo(page.epoch);
          break;
        }
        if (page.epoch < snapshot!.epoch) break; // a read from before a reset we already know about
        for (const e of page.events) {
          if (epochOf(e) !== 'same') continue;
          noteSeq(e.seq);
          apply(e.seq, e.row, e);
        }
        if (page.hasMore) {
          const fresh = await opts.api.fetchSnapshot(opts.shiftId);
          if (fresh.epoch > snapshot!.epoch) {
            adoptReset(fresh);
          } else if (fresh.epoch === snapshot!.epoch && fresh.seq > snapshot!.seq) publish(fresh);
          again = true;
        } else if (snapshot!.seq < maxSeen && (page.events.length > 0 || readWasEventual)) {
          // Events arrived during the read that it did not include yet, or an eventually
          // consistent read lagged behind a seq we know exists: read again, strongly.
          again = true;
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
    const reset = ResetMessageSchema.safeParse(data);
    if (reset.success) return void resetTo(reset.data.epoch);
    const parsed = ShiftEventSchema.safeParse(data);
    if (!parsed.success) return; // not ours or malformed: never let it touch the screen
    receive(parsed.data.seq, parsed.data.row, parsed.data);
  }

  function connect() {
    if (!started || !online || !visible || blocked || connection) return;
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
        scheduleVerify(VERIFY_EVERY_MS);
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
    if (verifyTimer !== null) clearTimer(verifyTimer);
    verifyTimer = null;
  }

  function scheduleReconnect() {
    if (!started) return;
    if (!online) return setState({ status: 'offline' });
    setState({ status: 'reconnecting' });
    if (blocked || !visible || reconnectTimer !== null) return;
    reconnectTimer = setTimer(
      () => {
        reconnectTimer = null;
        connect();
      },
      backoffDelay(attempt++, random),
    );
  }

  /** Closes the connection and cancels every timer: nothing more is sent until restarted. */
  function quiesce() {
    disconnect();
    if (catchUpRetry !== null) clearTimer(catchUpRetry);
    catchUpRetry = null;
    if (resetRetry !== null) clearTimer(resetRetry);
    resetRetry = null;
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
      quiesce();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    adoptSnapshot(next) {
      if (snapshot && next.epoch > snapshot.epoch) {
        // A refetch saw the reset before we heard about it: same as a reset message.
        adoptReset(next);
        if (subscribed) void catchUp();
        return;
      }
      // From before a reset we already applied: put ours back.
      if (snapshot && next.epoch < snapshot.epoch) return opts.onSnapshot(snapshot);
      // Within one epoch a lower seq is a stale read: put ours back.
      if (snapshot && next.seq < snapshot.seq) return opts.onSnapshot(snapshot);
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
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      if (!started) return;
      if (!visible) {
        quiesce();
        // Never "Live" while paused: the page shows Connecting when it comes back, until subscribed.
        if (online) setState({ status: 'connecting' });
        return;
      }
      if (!online) return setState({ status: 'offline' });
      attempt = 0;
      setState({ status: blocked ? 'reconnecting' : 'connecting' });
      connect(); // subscribe first; onSubscribed then catches up
    },
  };
}
