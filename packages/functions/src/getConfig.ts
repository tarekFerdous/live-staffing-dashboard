import type { RuntimeConfig } from '@staffing/domain';
import { json, withErrors, type HttpHandler } from './http';

/** GET /api/config → where this deployment's live channel is, so one client build runs anywhere. */
export function makeGetConfigHandler(config: RuntimeConfig): HttpHandler {
  return withErrors(async () => json(200, config));
}

/** The cloud config, from the Lambda environment (AppSync Events endpoints and the subscribe-only key). */
export function cloudConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const { EVENTS_HTTP_HOST, EVENTS_REALTIME_HOST, EVENTS_API_KEY } = env;
  if (!EVENTS_HTTP_HOST || !EVENTS_REALTIME_HOST || !EVENTS_API_KEY) {
    throw new Error('EVENTS_HTTP_HOST, EVENTS_REALTIME_HOST and EVENTS_API_KEY must be set');
  }
  return {
    mode: 'cloud',
    realtime: {
      url: `wss://${EVENTS_REALTIME_HOST}/event/realtime`,
      httpHost: EVENTS_HTTP_HOST,
      apiKey: EVENTS_API_KEY,
    },
  };
}
