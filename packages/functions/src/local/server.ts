// Local dev API: `pnpm dev` (needs `pnpm db:up` and `pnpm reset` once).
import { createClients, createShiftStore, LOCAL_ENDPOINT, LOCAL_TABLE } from '@staffing/store';
import { makeGetShiftHandler } from '../getShift';
import { createLocalServer } from './adapter';

const port = Number(process.env.PORT ?? 3001);
const { doc } = createClients({ endpoint: process.env.DYNAMODB_ENDPOINT ?? LOCAL_ENDPOINT });
const store = createShiftStore(doc, process.env.TABLE_NAME ?? LOCAL_TABLE);

createLocalServer([{ method: 'GET', path: '/api/shifts/{shiftId}', handler: makeGetShiftHandler(store) }]).listen(
  port,
  () => console.log(`Local API on http://localhost:${port}`),
);
