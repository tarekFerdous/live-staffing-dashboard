// Lambda entry point (bundled by esbuild in the CDK AppStack).
// The built site is a Lambda layer; layer contents are extracted read-only into /opt.
import { makeSiteHandler } from '../site';

export const handler = makeSiteHandler(process.env.SITE_DIR ?? '/opt', {
  eventsHosts: { http: process.env.EVENTS_HTTP_HOST, realtime: process.env.EVENTS_REALTIME_HOST },
});
