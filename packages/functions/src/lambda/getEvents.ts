// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { createClients, createShiftStore } from '@staffing/store';
import { makeGetEventsHandler } from '../getEvents';

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error('TABLE_NAME is not set');

const { doc } = createClients();
export const handler = makeGetEventsHandler(createShiftStore(doc, tableName));
