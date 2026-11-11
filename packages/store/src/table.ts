import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Provisioned 5/5 keeps every table inside the DynamoDB always-free tier. */
export const PROVISIONED_THROUGHPUT = { ReadCapacityUnits: 5, WriteCapacityUnits: 5 } as const;

export const LOCAL_ENDPOINT = 'http://localhost:8000';
export const LOCAL_TABLE = 'live-staffing-local';

export function tableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ...PROVISIONED_THROUGHPUT },
    StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_IMAGE' },
  };
}

/** Creates the table if it does not exist yet (DynamoDB Local / tests). */
export async function ensureTable(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    await client.send(new CreateTableCommand(tableDefinition(tableName)));
  }
}

export function createClients(opts: { endpoint?: string; region?: string } = {}) {
  const local = Boolean(opts.endpoint);
  const client = new DynamoDBClient({
    region: opts.region ?? process.env.AWS_REGION ?? 'ca-central-1',
    ...(local && {
      endpoint: opts.endpoint,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { client, doc };
}
