// Lambda entry point (bundled by esbuild in the CDK AppStack).
import { cloudConfig, makeGetConfigHandler } from '../getConfig';

export const handler = makeGetConfigHandler(cloudConfig());
