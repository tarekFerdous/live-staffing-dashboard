import { randomUUID } from 'node:crypto';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createClients, ensureTable } from './table';

export type TestDynamo = {
  endpoint: string;
  /** Creates a fresh, uniquely named table and returns its clients. */
  newTable(prefix?: string): Promise<ReturnType<typeof createClients> & { tableName: string }>;
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
      const tableName = `${prefix}-${randomUUID()}`;
      await ensureTable(clients.client, tableName);
      return { ...clients, tableName };
    },
    async stop() {
      await container?.stop();
    },
  };
}
