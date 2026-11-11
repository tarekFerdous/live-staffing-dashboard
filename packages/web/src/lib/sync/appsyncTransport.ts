// The AppSync Events WebSocket protocol, spoken directly (no Amplify), so connection
// state is fully under our control. https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html
import { RuntimeConfigSchema } from '@staffing/domain';
import type { Transport } from './shiftSync';

export type RealtimeConfig = {
  /** Absolute WebSocket URL: `wss://<id>.appsync-realtime-api.<region>.amazonaws.com/event/realtime` in the cloud. */
  url: string;
  /** `<id>.appsync-api.<region>.amazonaws.com`: named in the auth header. */
  httpHost: string;
  /** Subscribe-only API key. */
  apiKey: string;
};

/** Used until the server's connection_ack says otherwise (AppSync sends 300 000 ms). */
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 300_000;

type WebSocketLike = Pick<WebSocket, 'send' | 'close'> & {
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
};
export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

const base64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function appSyncTransport(
  cfg: RealtimeConfig,
  opts: {
    createSocket?: WebSocketFactory;
    newId?: () => string;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
  } = {},
): Transport {
  const createSocket: WebSocketFactory =
    opts.createSocket ?? ((url, protocols) => new WebSocket(url, protocols));
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const auth = { host: cfg.httpHost, 'x-api-key': cfg.apiKey };

  return {
    connect(channel, handlers) {
      const ws = createSocket(cfg.url, ['aws-appsync-event-ws', `header-${base64Url(JSON.stringify(auth))}`]);
      const subscriptionId = newId();
      let done = false;
      let keepAliveMs = DEFAULT_KEEPALIVE_TIMEOUT_MS;
      let watchdog: unknown = null;

      const stopWatchdog = () => {
        if (watchdog !== null) clearTimer(watchdog);
        watchdog = null;
      };
      // Any keep-alive (or other message) proves the connection is alive.
      const armWatchdog = () => {
        stopWatchdog();
        watchdog = setTimer(() => fail('keep-alive timeout'), keepAliveMs);
      };
      const finish = () => {
        done = true;
        stopWatchdog();
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // already closed
        }
      };
      function fail(reason: string) {
        if (done) return;
        finish();
        handlers.onClose(reason);
      }
      const send = (msg: unknown) => ws.send(JSON.stringify(msg));

      ws.onopen = () => {
        send({ type: 'connection_init' });
        armWatchdog();
      };
      ws.onmessage = (ev) => {
        let msg: { type?: string; id?: string; event?: unknown; connectionTimeoutMs?: number };
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        armWatchdog();
        switch (msg.type) {
          case 'connection_ack':
            if (typeof msg.connectionTimeoutMs === 'number' && msg.connectionTimeoutMs > 0) {
              keepAliveMs = msg.connectionTimeoutMs;
              armWatchdog();
            }
            send({ type: 'subscribe', id: subscriptionId, channel, authorization: auth });
            break;
          case 'subscribe_success':
            if (msg.id === subscriptionId) handlers.onSubscribed();
            break;
          case 'data':
            if (msg.id !== subscriptionId) break;
            try {
              handlers.onMessage(typeof msg.event === 'string' ? JSON.parse(msg.event) : msg.event);
            } catch {
              // not JSON: ignore, the sync would reject it anyway
            }
            break;
          case 'subscribe_error':
          case 'connection_error':
          case 'error':
            fail(msg.type);
            break;
          // 'ka' and anything else only refresh the watchdog
        }
      };
      ws.onclose = () => fail('socket closed');
      ws.onerror = () => fail('socket error');

      return {
        close() {
          if (done) return;
          try {
            send({ type: 'unsubscribe', id: subscriptionId });
          } catch {
            // socket not open yet
          }
          finish();
        },
      };
    },
  };
}

/**
 * Reads `GET /api/config` from the API this page is served with, so the same build runs
 * locally and in the cloud. A relative `url` (local mode) is resolved against `base`
 * (the page's address) with ws:// or wss:// to match. No config, or `realtime: null`,
 * means live updates are off and the app refetches after actions.
 */
export async function loadRealtimeConfig(
  fetchFn: typeof fetch = fetch,
  base: string = globalThis.location?.href ?? 'http://localhost/',
): Promise<RealtimeConfig | null> {
  try {
    const res = await fetchFn('/api/config', { cache: 'no-store' });
    if (!res.ok) return null;
    const parsed = RuntimeConfigSchema.safeParse(await res.json());
    const r = parsed.success ? parsed.data.realtime : null;
    if (!r) return null;
    const url = new URL(r.url, base);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    return { url: url.toString(), httpHost: r.httpHost, apiKey: r.apiKey };
  } catch {
    return null;
  }
}
