// Local mode: the API, the change feed and the live channel in one process, no AWS needed.
// `docker compose up` runs it (see README); `pnpm dev` runs it against `pnpm db:up`.
import {
  createClients,
  createShiftStore,
  LOCAL_ENDPOINT,
  LOCAL_IDEMPOTENCY_TABLE,
  LOCAL_TABLE,
  SEED,
} from '@staffing/store';
import { makeDemoResetHandler } from '../demoReset';
import { makeGetConfigHandler } from '../getConfig';
import { makeGetEventsHandler } from '../getEvents';
import { makeGetShiftHandler } from '../getShift';
import { makeActionHandler } from '../postAction';
import { makePublisher } from '../publisher';
import { createLocalServer } from './adapter';
import { createLocalChangeFeed, localStreamsClient } from './changeFeed';
import { createLocalEvents, EVENTS_PATH } from './events';

const port = Number(process.env.PORT ?? 3001);
const endpoint = process.env.DYNAMODB_ENDPOINT ?? LOCAL_ENDPOINT;
const tableName = process.env.TABLE_NAME ?? LOCAL_TABLE;
const { client, doc } = createClients({ endpoint });
const store = createShiftStore(doc, tableName);

const server = createLocalServer([
  {
    method: 'GET',
    path: '/api/config',
    // A path: the browser connects to its own origin, which proxies to this server.
    handler: makeGetConfigHandler({
      mode: 'local',
      realtime: { url: EVENTS_PATH, httpHost: 'localhost', apiKey: 'local' },
    }),
  },
  { method: 'GET', path: '/api/shifts/{shiftId}', handler: makeGetShiftHandler(store) },
  { method: 'GET', path: '/api/shifts/{shiftId}/events', handler: makeGetEventsHandler(store) },
  {
    method: 'POST',
    path: '/api/shifts/{shiftId}/workers/{workerId}/actions',
    handler: makeActionHandler({
      store,
      idempotency: { client, tableName: process.env.IDEMPOTENCY_TABLE ?? LOCAL_IDEMPOTENCY_TABLE },
    }),
  },
  { method: 'POST', path: '/api/demo/reset', handler: makeDemoResetHandler({ store, seeds: [SEED] }) },
]);

const events = createLocalEvents(server);
const feed = createLocalChangeFeed({ client, streams: localStreamsClient(endpoint), tableName }).start(
  makePublisher(events.publish),
);

server.listen(port, () => console.log(`Local API and live channel on http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await feed.stop();
    await events.close();
    server.close();
    process.exit(0);
  });
}
