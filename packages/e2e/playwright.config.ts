import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './lib/env';

/**
 * End-to-end tests against a running app: local mode (`docker compose up`) by default,
 * the deployed stage when BASE_URL is set. Every test resets the shared shift first,
 * so tests run one at a time.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
