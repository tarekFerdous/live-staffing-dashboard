/**
 * The README's demo GIF: the manager dashboard (desktop) and a worker's phone side by side, recorded
 * together. Invite → accept → check in live, then an outage on the manager page while the worker checks
 * out, and the catch-up when it comes back. Needs ffmpeg on the PATH.
 *
 *   pnpm demo-gif                      local mode (docker compose up), writes docs/demo.gif
 *   BASE_URL=<SiteUrl> pnpm demo-gif
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { BASE_URL, resetShift } from '../lib/env';
import * as ui from '../lib/ui';

const OUT = fileURLToPath(new URL('../../../docs/demo.gif', import.meta.url));
const HEIGHT = 1000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recorded(browser: Browser, dir: string, width: number) {
  const size = { width, height: HEIGHT };
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    colorScheme: 'light',
    viewport: size,
    recordVideo: { dir, size },
  });
  return ctx.newPage();
}

async function main() {
  await resetShift();
  const dir = mkdtempSync(join(tmpdir(), 'demo-gif-'));
  const browser = await chromium.launch();
  const start = Date.now();
  const manager = await recorded(browser, dir, 1280);
  const worker = await recorded(browser, dir, 400);

  await ui.openManager(manager);
  await ui.openWorker(worker, ui.WORKERS.amara);
  await manager.evaluate(() => document.fonts.ready);
  const skip = (Date.now() - start) / 1000; // drop the page loads from the GIF
  await pause(1200);

  const amara = ui.WORKERS.amara;
  await ui.actionButton(manager, 'Invite', amara).click();
  await manager.evaluate(() => window.scrollTo(0, 0)); // the click scrolled to the card; keep the header in view
  await ui.expectWorkerStatus(worker, 'Invited');
  await pause(1500);

  for (const [action, participation, attendance] of [
    ['Accept', 'Accepted', 'Not started'],
    ['Check in', 'Accepted', 'Checked in'],
  ] as const) {
    await ui.actionButton(worker, action, amara).click();
    await ui.expectManagerStatus(manager, amara, participation, attendance);
    await pause(1500);
  }

  await ui.outageSwitch(manager).click();
  await pause(1200);
  await ui.actionButton(worker, 'Check out', amara).click();
  await ui.expectWorkerStatus(worker, 'Accepted', 'Checked out');
  await pause(1500);
  await ui.outageSwitch(manager).click();
  await ui.expectManagerStatus(manager, amara, 'Accepted', 'Checked out');
  await pause(2500);

  const videos = [manager, worker].map((p: Page) => p.video()!);
  await manager.context().close();
  await worker.context().close();
  await browser.close();
  const [m, w] = await Promise.all(videos.map((v) => v.path()));

  const t = skip.toFixed(2);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      t,
      '-i',
      m!,
      '-ss',
      t,
      '-i',
      w!,
      '-filter_complex',
      '[0][1]hstack=shortest=1,fps=8,scale=1120:-1:flags=lanczos,split[a][b];' +
        '[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      OUT,
    ],
    { stdio: 'inherit' },
  );
  rmSync(dir, { recursive: true, force: true });
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
