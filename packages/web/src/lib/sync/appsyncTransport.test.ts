import { describe, expect, it, vi } from 'vitest';
import { appSyncTransport, loadRealtimeConfig, type WebSocketFactory } from './appsyncTransport';

const CFG = {
  httpHost: 'abc.appsync-api.ca-central-1.amazonaws.com',
  realtimeHost: 'abc.appsync-realtime-api.ca-central-1.amazonaws.com',
  apiKey: 'da2-key',
};

class FakeSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const createSocket: WebSocketFactory = (url, protocols) => {
    const s = new FakeSocket(url, protocols);
    sockets.push(s);
    return s;
  };
  const transport = appSyncTransport(CFG, {
    createSocket,
    newId: () => 'sub-1',
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => ((h as { cleared: boolean }).cleared = true),
  });
  const handlers = { onSubscribed: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
  const conn = transport.connect('/shifts/harbourfront-gala', handlers);
  return { socket: sockets[0]!, handlers, conn, timers, live: () => timers.filter((t) => !t.cleared) };
}

const decodeHeader = (protocol: string) => {
  const b64 = protocol.slice('header-'.length).replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
};

describe('AppSync Events transport', () => {
  it('connects with the API key in the subprotocol header, then subscribes after the ack', () => {
    const { socket, handlers } = setup();
    expect(socket.url).toBe(`wss://${CFG.realtimeHost}/event/realtime`);
    expect(socket.protocols[0]).toBe('aws-appsync-event-ws');
    expect(decodeHeader(socket.protocols[1]!)).toEqual({ host: CFG.httpHost, 'x-api-key': CFG.apiKey });

    socket.open();
    expect(socket.sent).toEqual([{ type: 'connection_init' }]);
    socket.receive({ type: 'connection_ack', connectionTimeoutMs: 300000 });
    expect(socket.sent[1]).toEqual({
      type: 'subscribe',
      id: 'sub-1',
      channel: '/shifts/harbourfront-gala',
      authorization: { host: CFG.httpHost, 'x-api-key': CFG.apiKey },
    });
    expect(handlers.onSubscribed).not.toHaveBeenCalled();
    socket.receive({ type: 'subscribe_success', id: 'sub-1' });
    expect(handlers.onSubscribed).toHaveBeenCalledTimes(1);
  });

  it('passes each data message on as parsed JSON', () => {
    const { socket, handlers } = setup();
    socket.open();
    socket.receive({ type: 'connection_ack', connectionTimeoutMs: 300000 });
    socket.receive({ type: 'subscribe_success', id: 'sub-1' });
    socket.receive({ type: 'data', id: 'sub-1', event: JSON.stringify({ seq: 1 }) });
    socket.receive({ type: 'data', id: 'other', event: JSON.stringify({ seq: 2 }) });
    expect(handlers.onMessage.mock.calls).toEqual([[{ seq: 1 }]]);
  });

  it('reports a close when keep-alives stop arriving', () => {
    const { socket, handlers, live } = setup();
    socket.open();
    socket.receive({ type: 'connection_ack', connectionTimeoutMs: 10_000 });
    socket.receive({ type: 'ka' });
    expect(live()).toHaveLength(1);
    expect(live()[0]!.ms).toBe(10_000);
    live()[0]!.fn();
    expect(handlers.onClose).toHaveBeenCalledWith('keep-alive timeout');
    expect(socket.closed).toBe(true);
  });

  it('reports a close once for socket close, error or a subscribe error', () => {
    for (const end of ['close', 'error', 'subscribe_error'] as const) {
      const { socket, handlers, live } = setup();
      socket.open();
      if (end === 'close') socket.onclose?.({} as CloseEvent);
      if (end === 'error') socket.onerror?.(new Event('error'));
      if (end === 'subscribe_error') socket.receive({ type: 'subscribe_error', id: 'sub-1' });
      socket.onclose?.({} as CloseEvent);
      expect(handlers.onClose, end).toHaveBeenCalledTimes(1);
      expect(live(), end).toEqual([]);
    }
  });

  it('close() unsubscribes and closes without reporting a close', () => {
    const { socket, handlers, conn } = setup();
    socket.open();
    socket.receive({ type: 'connection_ack', connectionTimeoutMs: 300000 });
    conn.close();
    expect(socket.sent.at(-1)).toEqual({ type: 'unsubscribe', id: 'sub-1' });
    expect(socket.closed).toBe(true);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});

describe('loadRealtimeConfig', () => {
  const respond = (status: number, body: string) =>
    (async () => new Response(body, { status })) as typeof fetch;

  it('reads the realtime block from /config.json', async () => {
    expect(await loadRealtimeConfig(respond(200, JSON.stringify({ realtime: CFG })))).toEqual(CFG);
  });

  it('returns null (live updates off) when the file is missing, not JSON or incomplete', async () => {
    expect(await loadRealtimeConfig(respond(404, ''))).toBeNull();
    expect(await loadRealtimeConfig(respond(200, '<!doctype html>'))).toBeNull();
    expect(
      await loadRealtimeConfig(respond(200, JSON.stringify({ realtime: { httpHost: 'x' } }))),
    ).toBeNull();
    const failing = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    expect(await loadRealtimeConfig(failing)).toBeNull();
  });
});
