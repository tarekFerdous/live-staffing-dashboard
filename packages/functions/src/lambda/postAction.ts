// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { createClients, createShiftStore } from '@staffing/store';
import { makeActionHandler } from '../postAction';

const tableName = process.env.TABLE_NAME;
const idempotencyTable = process.env.IDEMPOTENCY_TABLE;
if (!tableName || !idempotencyTable) throw new Error('TABLE_NAME and IDEMPOTENCY_TABLE must be set');

const { client, doc } = createClients();
export const handler = makeActionHandler({
  store: createShiftStore(doc, tableName),
  idempotency: { client, tableName: idempotencyTable },
});
