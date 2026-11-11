/** Test fixtures: every test starts from the seed, with a manager and a worker in separate browser contexts. */
import { test as base, type Page } from '@playwright/test';
import { resetShift } from './env';

export * from './ui';

export const test = base.extend<{ seeded: void; manager: Page; workerPage: Page }>({
  // An auto fixture, because a beforeEach in a shared module would only register for the
  // first spec file that imports it.
  seeded: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructured first argument.
    async ({}, use) => {
      await resetShift();
      await use();
    },
    { auto: true },
  ],
  // Contexts made here still honour `test.use({ colorScheme })`.
  manager: async ({ browser, colorScheme }, use) => {
    const ctx = await browser.newContext({ colorScheme });
    await use(await ctx.newPage());
    await ctx.close();
  },
  workerPage: async ({ browser, colorScheme }, use) => {
    const ctx = await browser.newContext({ colorScheme });
    await use(await ctx.newPage());
    await ctx.close();
  },
});
