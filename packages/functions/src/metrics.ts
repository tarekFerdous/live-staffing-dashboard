import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

/**
 * Per-hop timings of the cloud update path, read back from CloudWatch by the measurement
 * script (`packages/e2e/scripts/measure.ts`, which repeats these names):
 *
 * - `CommandDuration`: the action Lambda's handler, request in → response out.
 * - `CommitToPublisher`: the event's server timestamp (`at`) → the publisher starts on it,
 *   i.e. the DynamoDB write plus the stream and event source mapping.
 * - `PublishDuration`: the publisher's HTTP publish to AppSync Events.
 */
export type TimingName = 'CommandDuration' | 'CommitToPublisher' | 'PublishDuration';
export type RecordTiming = (name: TimingName, ms: number) => void;

export const METRICS_NAMESPACE = 'LiveStaffing';
export const METRICS_SERVICE = 'live-staffing';

/** Powertools metrics written as Embedded Metric Format log lines (no CloudWatch API calls). */
export function createLambdaMetrics() {
  const metrics = new Metrics({ namespace: METRICS_NAMESPACE, serviceName: METRICS_SERVICE });
  return {
    record: ((name, ms) => metrics.addMetric(name, MetricUnit.Milliseconds, ms)) as RecordTiming,
    flush: () => metrics.publishStoredMetrics(),
  };
}

/** Wraps a Lambda handler so each invocation records its duration and flushes its metrics. */
export function withTimings<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>,
  metrics: ReturnType<typeof createLambdaMetrics>,
  name: TimingName | null,
): (...args: A) => Promise<R> {
  return async (...args) => {
    const start = performance.now();
    try {
      return await handler(...args);
    } finally {
      if (name) metrics.record(name, performance.now() - start);
      metrics.flush();
    }
  };
}
