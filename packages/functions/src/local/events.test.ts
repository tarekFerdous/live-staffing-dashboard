// Contract test: the browser's own AppSync Events transport against the local ws server.
// The cloud side of the same contract runs after every deploy (`smoke:live`, CI only).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { appSyncTransport, type WebSocketFactory } from '../../../web/src/lib/sync/appsyncTransport';
import { channelMatches, createLocalEvents, EVENTS_PATH, type LocalEvents } from './events';

let server: Server;
let events: LocalEvents;

afterEach(async () => {
  await events?.close();
  await new Promise((r) => server?.close(r));
});

async function start(opts: { keepAliveMs?: number } = {}) {
  server = createServer();
  events = createLocalEvents(server, opts);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return `ws://127.0.0.1:${port}${EVENTS_PATH}`;
}

const createSocket = ((url: string, protocols: string[]) => {
  const ws = new WebSocket(url, protocols);
  return ws;
}) as unknown as WebSocketFactory;

function subscribe(url: string, channel: string) {
  const received: unknown[] = [];
  const closes: string[] = [];
  let resolveSubscribed!: () => void;
  const subscribed = new Promise<void>((r) => (resolveSubscribed = r));
  const transport = appSyncTransport({ url, httpHost: 'localhost', apiKey: 'local' }, { createSocket });
  const conn = transport.connect(channel, {
    onSubscribed: resolveSubscribed,
    onMessage: (d) => received.push(d),
    onClose: (reason) => closes.push(reason),
  });
  return { received, closes, subscribed, conn };
}

const until = async (check: () => boolean, ms = 2_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('local events server (AppSync Events protocol)', () => {
  it('acks, subscribes and delivers published events on the channel as parsed JSON', async () => {
    const url = await start();
    const a = subscribe(url, '/shifts/harbourfront-gala');
    const b = subscribe(url, '/shifts/other');
    await Promise.all([a.subscribed, b.subscribed]);

    await events.publish('/shifts/harbourfront-gala', [
      JSON.stringify({ seq: 1 }),
      JSON.stringify({ seq: 2 }),
    ]);
    await until(() => a.received.length === 2);
    expect(a.received).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(b.received).toEqual([]);
    a.conn.close();
    b.conn.close();
  });

  it('stops delivering after unsubscribe', async () => {
    const url = await start();
    const a = subscribe(url, '/shifts/x');
    await a.subscribed;
    a.conn.close();
    await until(() => events.connectionCount() === 0);
    await events.publish('/shifts/x', [JSON.stringify({ seq: 1 })]);
    expect(a.received).toEqual([]);
  });

  it('sends keep-alives that keep the connection open', async () => {
    const url = await start({ keepAliveMs: 20 });
    const raw = new WebSocket(url, ['aws-appsync-event-ws']);
    const types: string[] = [];
    raw.on('message', (m) => types.push(JSON.parse(String(m)).type));
    await new Promise((r) => raw.on('open', r));
    raw.send(JSON.stringify({ type: 'connection_init' }));
    await until(() => types.filter((t) => t === 'ka').length >= 2);
    expect(types[0]).toBe('connection_ack');
    raw.close();
  });

  it('refuses publishing from a client, as AppSync does for API-key clients', async () => {
    const url = await start();
    const raw = new WebSocket(url, ['aws-appsync-event-ws']);
    const msgs: { type: string }[] = [];
    raw.on('message', (m) => msgs.push(JSON.parse(String(m))));
    await new Promise((r) => raw.on('open', r));
    raw.send(JSON.stringify({ type: 'publish', id: 'p1', channel: '/shifts/x', events: ['{}'] }));
    await until(() => msgs.length > 0);
    expect(msgs[0]!.type).toBe('publish_error');
    raw.close();
  });

  it('rejects a socket without the events subprotocol', async () => {
    const url = await start();
    const raw = new WebSocket(url, ['something-else']);
    const failed = await new Promise<boolean>((r) => {
      raw.on('open', () => r(false));
      raw.on('error', () => r(true));
    });
    expect(failed).toBe(true);
  });
});

describe('channelMatches', () => {
  it('matches exact channels and one-level wildcards', () => {
    expect(channelMatches('/shifts/a', '/shifts/a')).toBe(true);
    expect(channelMatches('/shifts/a', '/shifts/b')).toBe(false);
    expect(channelMatches('/shifts/*', '/shifts/a')).toBe(true);
    expect(channelMatches('/shifts/*', '/shifts/a/b')).toBe(false);
    expect(channelMatches('/shifts/*', '/other/a')).toBe(false);
  });
});
