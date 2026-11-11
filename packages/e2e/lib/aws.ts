/** AWS lookups for the measurement scripts (the `staffing` profile, or CI's environment credentials). */
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { CloudWatchClient, GetMetricStatisticsCommand, type Dimension } from '@aws-sdk/client-cloudwatch';
import {
  GetFunctionConfigurationCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda';
import { fromIni } from '@aws-sdk/credential-providers';

export const STACK_NAME = 'LiveStaffingApp';
export const REGION = process.env.AWS_REGION ?? 'ca-central-1';
const credentials = process.env.AWS_ACCESS_KEY_ID
  ? undefined
  : fromIni({ profile: process.env.AWS_PROFILE ?? 'staffing' });

const cfn = new CloudFormationClient({ region: REGION, credentials });
const cw = new CloudWatchClient({ region: REGION, credentials });
const lambda = new LambdaClient({ region: REGION, credentials });

export async function stackOutput(key: string): Promise<string> {
  const res = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const value = res.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
  if (!value) throw new Error(`Stack ${STACK_NAME} has no ${key} output. Is it deployed?`);
  return value;
}

/** Physical id of the stack resource whose logical id starts with `prefix` (CDK adds a hash suffix). */
async function physicalId(type: string, prefix: string): Promise<string> {
  const res = await cfn.send(new DescribeStackResourcesCommand({ StackName: STACK_NAME }));
  const r = res.StackResources?.find(
    (x) => x.ResourceType === type && x.LogicalResourceId?.startsWith(prefix),
  );
  if (!r?.PhysicalResourceId) throw new Error(`No ${type} named ${prefix}* in ${STACK_NAME}`);
  return r.PhysicalResourceId;
}

/**
 * Forces the next invocation of each function to be a cold start by changing an environment
 * variable (Lambda then retires every warm instance). This drifts from the template until the
 * next deploy, which puts the template's environment back; nothing depends on the variable.
 */
export async function forceColdStarts(logicalPrefixes: string[]): Promise<void> {
  for (const prefix of logicalPrefixes) {
    const FunctionName = await physicalId('AWS::Lambda::Function', prefix);
    const cfg = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName }));
    await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName,
        Environment: { Variables: { ...cfg.Environment?.Variables, MEASURE_COLD_START: String(Date.now()) } },
      }),
    );
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName });
  }
}

export type Stat = { count: number; p50: number; p95: number; max: number };

async function statistic(
  namespace: string,
  metricName: string,
  dimensions: Dimension[],
  start: Date,
  end: Date,
  extended: boolean,
) {
  // One datapoint covering the whole window: whole minutes from the minute `start` falls in
  // (the period must be a multiple of 60 s).
  const from = Math.floor(start.getTime() / 60_000) * 60_000;
  const Period = Math.ceil((end.getTime() - from) / 60_000) * 60;
  const res = await cw.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      Dimensions: dimensions,
      StartTime: new Date(from),
      EndTime: new Date(from + Period * 1000),
      Period,
      Statistics: ['SampleCount', 'Maximum', 'Sum'],
      ...(extended ? { ExtendedStatistics: ['p50', 'p95'] } : {}),
    }),
  );
  return res.Datapoints?.[0];
}

/** p50 / p95 / max of a custom metric over [start, end], waiting for late EMF lines to land. */
export async function metricStats(
  namespace: string,
  metricName: string,
  dimensions: Dimension[],
  start: Date,
  end: Date,
  expectedCount: number,
): Promise<Stat | null> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const d = await statistic(namespace, metricName, dimensions, start, end, true);
    const count = d?.SampleCount ?? 0;
    if (d && (count >= expectedCount || Date.now() > deadline)) {
      return {
        count,
        p50: d.ExtendedStatistics?.p50 ?? NaN,
        p95: d.ExtendedStatistics?.p95 ?? NaN,
        max: d.Maximum ?? NaN,
      };
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/** Throttle events on the shift table during [start, end] (0 means provisioned 5/5 was enough). */
export async function tableThrottles(start: Date, end: Date) {
  const TableName = await stackOutput('TableName');
  const sum = async (metric: string) =>
    (await statistic('AWS/DynamoDB', metric, [{ Name: 'TableName', Value: TableName }], start, end, false))
      ?.Sum ?? 0;
  return {
    readThrottleEvents: await sum('ReadThrottleEvents'),
    writeThrottleEvents: await sum('WriteThrottleEvents'),
  };
}
