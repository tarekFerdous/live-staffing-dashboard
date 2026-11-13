// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { registerEnglishMessages } from '@staffing/domain';
import { createAppSyncPublisher } from '../appsync';
import { createLambdaMetrics, withTimings } from '../metrics';
import { makePublisher } from '../publisher';

registerEnglishMessages(); // readable zod messages when a stream record doesn't parse

const httpHost = process.env.EVENTS_HTTP_HOST;
const region = process.env.AWS_REGION;
if (!httpHost || !region) throw new Error('EVENTS_HTTP_HOST and AWS_REGION must be set');

const metrics = createLambdaMetrics();
export const handler = withTimings(
  makePublisher(createAppSyncPublisher({ httpHost, region }), undefined, metrics.record),
  metrics,
  null,
);
