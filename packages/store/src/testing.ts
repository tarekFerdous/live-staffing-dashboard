import { randomUUID } from 'node:crypto';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createClients, ensureTable, idempotencyTableDefinition, tableDefinition } from './table';

export type TestTables = ReturnType<typeof createClients> & { tableName: string; idempotencyTableName: string };

export type TestDynamo = {
  endpoint: string;
  /** Creates a fresh, uniquely named shift table and idempotency table. */
  newTable(prefix?: string): Promise<TestTables>;
  stop(): Promise<void>;
};

/**
 * Real DynamoDB Local for integration tests. Uses `DYNAMODB_ENDPOINT` when set
 * (CI service container), otherwise starts one with Testcontainers.
 */
export async function startTestDynamo(): Promise<TestDynamo> {
  let container: StartedTestContainer | undefined;
  let endpoint = process.env.DYNAMODB_ENDPOINT;
  if (!endpoint) {
    container = await new GenericContainer('amazon/dynamodb-local:2.5.3')
      .withCommand(['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb'])
      .withExposedPorts(8000)
      .start();
    endpoint = `http://${container.getHost()}:${container.getMappedPort(8000)}`;
  }
  const ep = endpoint;
  return {
    endpoint: ep,
    async newTable(prefix = 'test') {
      const clients = createClients({ endpoint: ep });
      const id = randomUUID();
      const tableName = `${prefix}-${id}`;
      const idempotencyTableName = `${prefix}-idem-${id}`;
      await ensureTable(clients.client, tableDefinition(tableName));
      await ensureTable(clients.client, idempotencyTableDefinition(idempotencyTableName));
      return { ...clients, tableName, idempotencyTableName };
    },
    async stop() {
      await container?.stop();
    },
  };
}
