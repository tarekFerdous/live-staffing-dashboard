import type { Transport, TransportHandlers } from '../lib/sync/shiftSync';

export type FakeConnection = {
  channel: string;
  handlers: TransportHandlers;
  closed: boolean;
  /** Confirm the subscription (the server's subscribe_success). */
  subscribed(): void;
  /** Deliver one message on the channel. */
  send(data: unknown): void;
  /** The server or network drops the connection. */
  drop(reason?: string): void;
};

/** An in-memory Transport: tests drive each connection by hand. */
export function fakeTransport() {
  const connections: FakeConnection[] = [];
  /** Ordered record of what happened, to check subscribe-before-fetch. */
  const log: string[] = [];
  const transport: Transport = {
    connect(channel, handlers) {
      log.push('connect');
      const c: FakeConnection = {
        channel,
        handlers,
        closed: false,
        subscribed() {
          log.push('subscribed');
          handlers.onSubscribed();
        },
        send(data) {
          if (!c.closed) handlers.onMessage(data);
        },
        drop(reason = 'closed') {
          if (c.closed) return;
          c.closed = true;
          handlers.onClose(reason);
        },
      };
      connections.push(c);
      return {
        close() {
          c.closed = true;
        },
      };
    },
  };
  return {
    transport,
    connections,
    log,
    get last() {
      return connections.at(-1)!;
    },
  };
}
