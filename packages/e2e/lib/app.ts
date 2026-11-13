/** Test fixtures: every test starts from the seed, with a manager and a worker in separate browser contexts. */
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { resetShift } from './env';

export * from './ui';

const CSP_MARKER = '[csp-violation]';

/**
 * Fails the test on any Content-Security-Policy violation in any page it opens: the default
 * `context`, the fixtures' own contexts, and contexts a test makes with `browser.newContext`.
 * The deployed site sends a strict CSP (#75); local mode (Vite) sends none, so this stays quiet there.
 */
async function watchCsp(ctx: BrowserContext, violations: string[]) {
  await ctx.addInitScript((marker) => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`${marker} ${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`),
    );
  }, CSP_MARKER);
  const watchPage = (page: Page) =>
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && (text.startsWith(CSP_MARKER) || /Content Security Policy/i.test(text)))
        violations.push(`${page.url()}: ${text}`);
    });
  ctx.pages().forEach(watchPage);
  ctx.on('page', watchPage);
}

export const test = base.extend<{ seeded: void; cspGuard: void; manager: Page; workerPage: Page }>({
  cspGuard: [
    async ({ browser, context }, use) => {
      const violations: string[] = [];
      await watchCsp(context, violations);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const ctx = await newContext(...args);
        await watchCsp(ctx, violations);
        return ctx;
      };
      try {
        await use();
      } finally {
        browser.newContext = newContext;
      }
      expect(violations, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- cspGuard first, so these contexts are watched.
  manager: async ({ browser, colorScheme, cspGuard }, use) => {
    const ctx = await browser.newContext({ colorScheme });
    await use(await ctx.newPage());
    await ctx.close();
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- as above.
  workerPage: async ({ browser, colorScheme, cspGuard }, use) => {
    const ctx = await browser.newContext({ colorScheme });
    await use(await ctx.newPage());
    await ctx.close();
  },
});
