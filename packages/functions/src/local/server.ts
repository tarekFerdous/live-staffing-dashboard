// Local dev API: `pnpm dev` (needs `pnpm db:up` and `pnpm reset` once).
import {
  createClients,
  createShiftStore,
  LOCAL_ENDPOINT,
  LOCAL_IDEMPOTENCY_TABLE,
  LOCAL_TABLE,
} from '@staffing/store';
import { makeGetEventsHandler } from '../getEvents';
import { makeGetShiftHandler } from '../getShift';
import { makeActionHandler } from '../postAction';
import { createLocalServer } from './adapter';

const port = Number(process.env.PORT ?? 3001);
const { client, doc } = createClients({ endpoint: process.env.DYNAMODB_ENDPOINT ?? LOCAL_ENDPOINT });
const store = createShiftStore(doc, process.env.TABLE_NAME ?? LOCAL_TABLE);

createLocalServer([
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
]).listen(port, () => console.log(`Local API on http://localhost:${port}`));
