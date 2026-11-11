// Local ChangeFeed: reads DynamoDB Local's stream API the way the Lambda event source
// mapping reads DynamoDB Streams in the cloud, and hands each batch to the same publisher.
import {
  DescribeTableCommand,
  ResourceNotFoundException,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
  type ShardIteratorType,
} from '@aws-sdk/client-dynamodb-streams';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { ChangeFeed } from '../ports';

const POLL_MS = 100;
/** How often to look for new shards (DynamoDB Local rolls shards over time). */
const DISCOVER_EVERY_MS = 2_000;
const RETRY_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function localStreamsClient(endpoint: string, region = process.env.AWS_REGION ?? 'ca-central-1') {
  return new DynamoDBStreamsClient({
    region,
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
}

export function createLocalChangeFeed(opts: {
  client: DynamoDBClient;
  streams: DynamoDBStreamsClient;
  tableName: string;
  pollMs?: number;
  log?: (msg: string) => void;
}): ChangeFeed {
  const pollMs = opts.pollMs ?? POLL_MS;
  const log = opts.log ?? ((m: string) => console.log(`[change feed] ${m}`));

  return {
    start(onChanges) {
      let stopped = false;

      async function run() {
        let streamArn: string | undefined;
        /** Open shards → next iterator. A shard is dropped once it is closed and drained. */
        let iterators = new Map<string, string>();
        let known = new Set<string>();
        let lastDiscovery = 0;
        let waitingForTable = false;

        async function discover(type: ShardIteratorType) {
          const res = await opts.streams.send(new DescribeStreamCommand({ StreamArn: streamArn }));
          for (const shard of res.StreamDescription?.Shards ?? []) {
            if (!shard.ShardId || known.has(shard.ShardId)) continue;
            known.add(shard.ShardId);
            const it = await opts.streams.send(
              new GetShardIteratorCommand({
                StreamArn: streamArn,
                ShardId: shard.ShardId,
                ShardIteratorType: type,
              }),
            );
            if (it.ShardIterator) iterators.set(shard.ShardId, it.ShardIterator);
          }
          lastDiscovery = Date.now();
        }

        while (!stopped) {
          try {
            if (!streamArn) {
              const table = await opts.client.send(new DescribeTableCommand({ TableName: opts.tableName }));
              streamArn = table.Table?.LatestStreamArn;
              if (!streamArn) throw new Error(`Table ${opts.tableName} has no stream`);
              iterators = new Map();
              known = new Set();
              // Start from now: changes made before the API started are already in every snapshot.
              await discover('LATEST');
              waitingForTable = false;
              log(`reading ${opts.tableName}`);
            } else if (Date.now() - lastDiscovery > DISCOVER_EVERY_MS) {
              // A shard that appears later holds only changes we have not seen yet.
              await discover('TRIM_HORIZON');
            }

            for (const [shardId, iterator] of iterators) {
              const res = await opts.streams.send(new GetRecordsCommand({ ShardIterator: iterator }));
              const records = res.Records ?? [];
              if (records.length) {
                try {
                  await onChanges({ Records: records } as unknown as DynamoDBStreamEvent);
                } catch (err) {
                  // In the cloud a failed batch is retried and then sent to a DLQ; here it is logged.
                  log(`publish failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
              if (res.NextShardIterator) iterators.set(shardId, res.NextShardIterator);
              else iterators.delete(shardId);
            }
            await sleep(pollMs);
          } catch (err) {
            if (
              err instanceof ResourceNotFoundException ||
              (err as Error).name === 'ResourceNotFoundException'
            ) {
              if (!waitingForTable) log(`waiting for table ${opts.tableName} (run \`pnpm reset\`)`);
              waitingForTable = true;
            } else {
              log(`error, retrying: ${err instanceof Error ? err.message : String(err)}`);
            }
            // The table may have been recreated (DynamoDB Local runs in memory): find its stream again.
            streamArn = undefined;
            await sleep(RETRY_MS);
          }
        }
      }

      const done = run();
      return {
        async stop() {
          stopped = true;
          await done;
        },
      };
    },
  };
}
