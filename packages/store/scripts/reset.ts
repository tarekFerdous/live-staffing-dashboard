/**
 * Restores the seeded shift: one shift, three Uninvited workers, empty event log.
 *
 *   pnpm reset            DynamoDB Local (docker compose), creates the table if needed
 *   pnpm reset --stage    the deployed AppStack, using the `staffing` AWS profile
 */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  createClients,
  createShiftStore,
  ensureTable,
  idempotencyTableDefinition,
  LOCAL_ENDPOINT,
  LOCAL_IDEMPOTENCY_TABLE,
  LOCAL_TABLE,
  SEED,
  tableDefinition,
} from '../src';

const APP_STACK_NAME = 'LiveStaffingApp';
const REGION = process.env.AWS_REGION ?? 'ca-central-1';

async function stageTable() {
  const credentials = process.env.AWS_ACCESS_KEY_ID
    ? undefined
    : fromIni({ profile: process.env.AWS_PROFILE ?? 'staffing' });
  const cfn = new CloudFormationClient({ region: REGION, credentials });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: APP_STACK_NAME }));
  const tableName = res.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === 'TableName')?.OutputValue;
  if (!tableName) throw new Error(`Stack ${APP_STACK_NAME} has no TableName output. Is it deployed?`);
  const client = new DynamoDBClient({ region: REGION, credentials });
  return { doc: DynamoDBDocumentClient.from(client), tableName };
}

async function localTable() {
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? LOCAL_ENDPOINT;
  const tableName = process.env.TABLE_NAME ?? LOCAL_TABLE;
  const { client, doc } = createClients({ endpoint });
  try {
    await ensureTable(client, tableDefinition(tableName));
    await ensureTable(client, idempotencyTableDefinition(process.env.IDEMPOTENCY_TABLE ?? LOCAL_IDEMPOTENCY_TABLE));
  } catch (err) {
    throw new Error(`Cannot reach DynamoDB Local at ${endpoint}. Run \`pnpm db:up\` first.`, { cause: err });
  }
  return { doc, tableName };
}

async function main() {
  const stage = process.argv.includes('--stage');
  const { doc, tableName } = stage ? await stageTable() : await localTable();
  await createShiftStore(doc, tableName).resetShift(SEED);
  console.log(`Reset shift "${SEED.shift.id}" in ${tableName}: ${SEED.workers.length} workers, all Uninvited.`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
