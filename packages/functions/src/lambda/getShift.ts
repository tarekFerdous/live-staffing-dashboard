// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { createClients, createShiftStore } from '@staffing/store';
import { makeGetShiftHandler } from '../getShift';

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error('TABLE_NAME is not set');

const { doc } = createClients();
export const handler = makeGetShiftHandler(createShiftStore(doc, tableName));
