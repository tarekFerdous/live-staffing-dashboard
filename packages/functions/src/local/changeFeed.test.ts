// Local mode end to end inside one process: a committed action in DynamoDB Local goes
// through the local change feed and the real publisher to a local ws subscriber.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ShiftEventSchema } from '@staffing/domain';
import { createShiftStore, SEED } from '@staffing/store';
import { startTestDynamo, type TestDynamo } from '@staffing/store/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { appSyncTransport, type WebSocketFactory } from '../../../web/src/lib/sync/appsyncTransport';
import { makePublisher } from '../publisher';
import { createLocalChangeFeed, localStreamsClient } from './changeFeed';
import { createLocalEvents, EVENTS_PATH } from './events';

let dynamo: TestDynamo;
beforeAll(async () => {
  dynamo = await startTestDynamo();
}, 180_000);
afterAll(() => dynamo?.stop());

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('local change feed', () => {
  it('pushes each committed action, in order, to subscribers of the shift channel', async () => {
    const { client, doc, tableName } = await dynamo.newTable('feed');
    const store = createShiftStore(doc, tableName);
    await store.resetShift(SEED);

    const server: Server = createServer();
    const events = createLocalEvents(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const logs: string[] = [];
    const feed = createLocalChangeFeed({
      client,
      streams: localStreamsClient(dynamo.endpoint),
      tableName,
      pollMs: 20,
      log: (m) => logs.push(m),
    }).start(makePublisher(events.publish));

    const received: unknown[] = [];
    let subscribed!: () => void;
    const ready = new Promise<void>((r) => (subscribed = r));
    const conn = appSyncTransport(
      { url: `ws://127.0.0.1:${port}${EVENTS_PATH}`, httpHost: 'localhost', apiKey: 'local' },
      { createSocket: ((u: string, p: string[]) => new WebSocket(u, p)) as unknown as WebSocketFactory },
    ).connect(`/shifts/${SEED.shift.id}`, {
      onSubscribed: () => subscribed(),
      onMessage: (d) => received.push(d),
      onClose: () => {},
    });

    try {
      await ready;
      await until(() => logs.some((l) => l.startsWith('reading')));
      const worker = SEED.workers[0]!.id;
      await store.applyAction(SEED.shift.id, worker, 'invite');
      await store.applyAction(SEED.shift.id, worker, 'accept');

      await until(() => received.length === 2);
      const parsed = received.map((r) => ShiftEventSchema.parse(r));
      expect(parsed.map((e) => [e.seq, e.type, e.row.participation])).toEqual([
        [1, 'invite', 'invited'],
        [2, 'accept', 'accepted'],
      ]);
      expect(parsed.every((e) => typeof e.publishedAt === 'string')).toBe(true);
    } finally {
      conn.close();
      await feed.stop();
      await events.close();
      await new Promise((r) => server.close(r));
    }
  });

  it('waits for a table that does not exist yet instead of failing', async () => {
    const { client } = await dynamo.newTable('feed-missing');
    const logs: string[] = [];
    const feed = createLocalChangeFeed({
      client,
      streams: localStreamsClient(dynamo.endpoint),
      tableName: 'no-such-table',
      log: (m) => logs.push(m),
    }).start(async () => {});
    await until(() => logs.length > 0);
    await feed.stop();
    expect(logs[0]).toMatch(/waiting for table no-such-table/);
  });
});
