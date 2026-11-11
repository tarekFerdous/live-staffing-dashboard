// AppStack: `pnpm run deploy` from the repo root (builds the web app first).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { APP_STACK_NAME, cdkEnv, tagApp } from '../lib/config';

const siteAssetPath = join(import.meta.dirname, '../../web/dist');
if (!existsSync(join(siteAssetPath, 'index.html'))) {
  throw new Error(`No built site at ${siteAssetPath}. Run \`pnpm build:web\` first.`);
}

const app = new App();
tagApp(app);
new AppStack(app, APP_STACK_NAME, { env: cdkEnv(), siteAssetPath });
