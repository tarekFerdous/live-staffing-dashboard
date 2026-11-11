// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { createClients, createShiftStore, SEED } from '@staffing/store';
import { makeDemoResetHandler } from '../demoReset';

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error('TABLE_NAME is not set');

const { doc } = createClients();
export const handler = makeDemoResetHandler({ store: createShiftStore(doc, tableName), seeds: [SEED] });
