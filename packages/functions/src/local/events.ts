// A local stand-in for AppSync Events: speaks the same WebSocket protocol the browser
// transport uses (https://docs.aws.amazon.com/appsync/latest/eventapi/event-api-websocket-protocol.html),
// so the client cannot tell local from cloud. Publishing is in-process only, just as
// publishing in the cloud is IAM-only: a browser cannot publish on a channel.
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Publish } from '../appsync';

export const EVENTS_PATH = '/event/realtime';
export const EVENTS_SUBPROTOCOL = 'aws-appsync-event-ws';

/** Same values AppSync sends: connection timeout in the ack, keep-alives well inside it. */
const CONNECTION_TIMEOUT_MS = 300_000;
const KEEP_ALIVE_MS = 60_000;

/** `/shifts/a` matches itself; `/shifts/*` matches every channel one level under `/shifts`. */
export function channelMatches(subscription: string, channel: string): boolean {
  if (subscription === channel) return true;
  if (!subscription.endsWith('/*')) return false;
  const prefix = subscription.slice(0, -1);
  return channel.startsWith(prefix) && !channel.slice(prefix.length).includes('/');
}

type Msg = { type?: unknown; id?: unknown; channel?: unknown };

export type LocalEvents = {
  publish: Publish;
  /** Open connections (for tests). */
  connectionCount(): number;
  close(): Promise<void>;
};

export function createLocalEvents(
  server: Server,
  opts: { path?: string; keepAliveMs?: number; connectionTimeoutMs?: number } = {},
): LocalEvents {
  const keepAliveMs = opts.keepAliveMs ?? KEEP_ALIVE_MS;
  const connectionTimeoutMs = opts.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS;
  const wss = new WebSocketServer({
    server,
    path: opts.path ?? EVENTS_PATH,
    // Like AppSync, only clients asking for the events subprotocol are accepted.
    handleProtocols: (protocols) => (protocols.has(EVENTS_SUBPROTOCOL) ? EVENTS_SUBPROTOCOL : false),
  });
  /** Per socket: subscription id → channel. */
  const subscriptions = new Map<WebSocket, Map<string, string>>();

  wss.on('connection', (ws) => {
    const subs = new Map<string, string>();
    subscriptions.set(ws, subs);
    let keepAlive: NodeJS.Timeout | null = null;
    const send = (msg: unknown) => ws.send(JSON.stringify(msg));

    ws.on('message', (raw) => {
      let msg: Msg;
      try {
        msg = JSON.parse(String(raw)) as Msg;
      } catch {
        return send({
          type: 'error',
          errors: [{ errorType: 'BadRequestException', message: 'Invalid JSON' }],
        });
      }
      const id = typeof msg.id === 'string' ? msg.id : undefined;
      switch (msg.type) {
        case 'connection_init':
          send({ type: 'connection_ack', connectionTimeoutMs });
          keepAlive ??= setInterval(() => send({ type: 'ka' }), keepAliveMs);
          return;
        case 'subscribe':
          if (!id || typeof msg.channel !== 'string' || !msg.channel.startsWith('/')) {
            return send({
              type: 'subscribe_error',
              id,
              errors: [{ errorType: 'BadRequestException', message: 'subscribe needs an id and a channel' }],
            });
          }
          subs.set(id, msg.channel);
          return send({ type: 'subscribe_success', id });
        case 'unsubscribe':
          if (id) subs.delete(id);
          return send({ type: 'unsubscribe_success', id });
        case 'publish':
          return send({
            type: 'publish_error',
            id,
            errors: [{ errorType: 'UnauthorizedException', message: 'Browsers cannot publish' }],
          });
        default:
          return send({ type: 'error', id, errors: [{ errorType: 'UnsupportedOperation' }] });
      }
    });
    ws.on('close', () => {
      if (keepAlive) clearInterval(keepAlive);
      subscriptions.delete(ws);
    });
  });

  return {
    async publish(channel, events) {
      for (const [ws, subs] of subscriptions) {
        if (ws.readyState !== ws.OPEN) continue;
        for (const [id, subscribed] of subs) {
          if (!channelMatches(subscribed, channel)) continue;
          // AppSync delivers each event as a JSON string in `event`.
          for (const event of events) ws.send(JSON.stringify({ type: 'data', id, event }));
        }
      }
    },
    connectionCount: () => subscriptions.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}
