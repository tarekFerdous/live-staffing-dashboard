// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { createAppSyncPublisher } from '../appsync';
import { makePublisher } from '../publisher';

const httpHost = process.env.EVENTS_HTTP_HOST;
const region = process.env.AWS_REGION;
if (!httpHost || !region) throw new Error('EVENTS_HTTP_HOST and AWS_REGION must be set');

export const handler = makePublisher(createAppSyncPublisher({ httpHost, region }));
