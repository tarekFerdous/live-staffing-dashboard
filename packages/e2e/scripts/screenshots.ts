/**
 * README screenshots of both pages in light and dark, on desktop and at 400 px, with a few
 * changes made first so the pages have something to show. Also fails if either page scrolls
 * sideways at 400 px.
 *
 *   pnpm screenshots              local mode (docker compose up), writes docs/screenshots/*.png
 *   BASE_URL=<SiteUrl> pnpm screenshots
 *   options: --out <dir>
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from '@playwright/test';
import { BASE_URL, resetShift } from '../lib/env';
import * as ui from '../lib/ui';

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const OUT = args.out ?? fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 400, height: 860 } } as const;
type Theme = 'light' | 'dark';

async function open(browser: Browser, theme: Theme, viewport: keyof typeof VIEWPORTS) {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    colorScheme: theme,
    viewport: VIEWPORTS[viewport],
    // Retina for the narrow phone shots only; the desktop ones are big enough at 1×.
    deviceScaleFactor: viewport === 'phone' ? 2 : 1,
    reducedMotion: 'reduce',
  });
  return ctx.newPage();
}

async function noSideScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) throw new Error(`${label} scrolls sideways by ${overflow} px`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await resetShift();
  const browser = await chromium.launch();

  // Some history: Amara checked in, Liam accepted, Sofia declined.
  const manager = await open(browser, 'light', 'desktop');
  const worker = await open(browser, 'light', 'desktop');
  await ui.openManager(manager);
  for (const name of Object.values(ui.WORKERS)) await ui.actionButton(manager, 'Invite', name).click();
  for (const [name, actions] of [
    [ui.WORKERS.amara, ['Accept', 'Check in']],
    [ui.WORKERS.liam, ['Accept']],
    [ui.WORKERS.sofia, ['Decline']],
  ] as const) {
    await ui.openWorker(worker, name);
    for (const a of actions) {
      await ui.actionButton(worker, a, name).click();
      await worker.waitForResponse((r) => r.url().includes('/actions'));
    }
  }
  await ui.expectManagerStatus(manager, ui.WORKERS.amara, 'Accepted', 'Checked in');
  await manager.context().close();
  await worker.context().close();

  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of ['desktop', 'phone'] as const) {
      const m = await open(browser, theme, viewport);
      await ui.openManager(m);
      await ui.expectManagerStatus(m, ui.WORKERS.amara, 'Accepted', 'Checked in');
      await m.evaluate(() => document.fonts.ready);
      await noSideScroll(m, `manager (${theme}, ${viewport})`);
      await m.screenshot({ path: `${OUT}/manager-${theme}-${viewport}.png`, fullPage: true });

      const w = await open(browser, theme, viewport);
      await ui.openWorker(w, ui.WORKERS.liam);
      await ui.expectWorkerStatus(w, 'Accepted');
      await w.evaluate(() => document.fonts.ready);
      await noSideScroll(w, `worker (${theme}, ${viewport})`);
      await w.screenshot({ path: `${OUT}/worker-${theme}-${viewport}.png`, fullPage: true });
      await m.context().close();
      await w.context().close();
    }
  }
  await browser.close();
  console.log(`Wrote screenshots to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
