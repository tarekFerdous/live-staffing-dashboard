/**
 * Measures update delay and recovery time with a real worker page and manager page.
 *
 *   pnpm measure                      local mode (docker compose up), writes results/local.json
 *   pnpm measure --stage              the deployed stack (`staffing` profile), writes results/stage.json
 *   options: --runs 100  --recovery-runs 20  --conditions "home Wi-Fi, Toronto → ca-central-1"
 *
 * Update delay: the worker clicks Accept or Cancel (alternating) → the manager's page shows the new
 * status. Recovery: with the manager in simulated outage, the worker makes 3 changes; the manager
 * switches the outage off → its page matches the server snapshot again.
 *
 * Both ends are timestamped inside the browser with `performance.timeOrigin + performance.now()`.
 * Both pages run in one browser on one machine, so they read the same clock: no skew, and
 * Playwright's own round trips are not counted. Runs are sequential with a pause in between, so the
 * table's provisioned 5/5 capacity is never exceeded (checked against CloudWatch on the stage).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Locator, type Page } from '@playwright/test';
import type { Participation } from '../lib/ui';

const { values: args } = parseArgs({
  options: {
    stage: { type: 'boolean', default: false },
    runs: { type: 'string', default: '100' },
    'recovery-runs': { type: 'string', default: '20' },
    conditions: { type: 'string', default: '' },
    /** Only the cold-start measurement (stage), printed and not written: for repeated samples. */
    'cold-only': { type: 'boolean', default: false },
  },
});
const RUNS = Number(args.runs);
const RECOVERY_RUNS = Number(args['recovery-runs']);
const STAGE = args.stage;
/** Pause between runs. On the stage each action writes ~8 WCU; 5 WCU/s plus burst covers this pace. */
const PAUSE_MS = STAGE ? 1_000 : 200;

// env.ts reads BASE_URL when it is imported, so resolve the stage URL first.
const aws = STAGE ? await import('../lib/aws') : null;
if (STAGE && !process.env.BASE_URL) process.env.BASE_URL = await aws!.stackOutput('SiteUrl');
const { BASE_URL, IS_STAGE, resetShift, SHIFT_ID } = await import('../lib/env');
const ui = await import('../lib/ui');
if (STAGE !== IS_STAGE) throw new Error(`--stage and BASE_URL disagree (${BASE_URL})`);

const AMARA = ui.WORKERS.amara;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- statistics ----------

type Summary = { n: number; p50: number; p95: number; max: number; min: number; mean: number };

/** Nearest-rank percentile. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(samples: number[]): Summary {
  const s = [...samples].sort((a, b) => a - b);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    n: s.length,
    p50: round(percentile(s, 50)),
    p95: round(percentile(s, 95)),
    max: round(s[s.length - 1]!),
    min: round(s[0]!),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

// ---------- in-page clocks ----------

/** Records the time of every click on the page, at dispatch (capture phase). */
async function recordClicks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __clicks: number[] };
    w.__clicks = [];
    document.addEventListener(
      'click',
      () => w.__clicks.push(performance.timeOrigin + performance.now()),
      true,
    );
  });
}

async function lastClick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __clicks: number[] }).__clicks.at(-1)!);
}

/**
 * Starts watching `target` (one worker's tracker text on the manager page) for the moment it shows `text`
 * and, if given, the Filled count reads `filled`. Returns a function that resolves to that
 * moment. Watching starts before the action, so nothing is missed. (The row and the counts
 * are rendered from the same snapshot in one commit, so a change to the row is enough to look.)
 */
async function watch(target: Locator, text: string, filled?: number): Promise<() => Promise<number>> {
  await target.evaluate(
    (el, { text, filled }) => {
      const done = () =>
        el.textContent!.includes(text) &&
        (filled === undefined ||
          document.querySelector('[data-testid="count-filled"]')?.textContent === String(filled));
      const w = window as unknown as { __seen: Promise<number> };
      w.__seen = new Promise((resolve) => {
        const obs = new MutationObserver(() => {
          if (!done()) return;
          obs.disconnect();
          resolve(performance.timeOrigin + performance.now());
        });
        obs.observe(el, { subtree: true, childList: true, characterData: true });
      });
    },
    { text, filled },
  );
  return () => target.page().evaluate(() => (window as unknown as { __seen: Promise<number> }).__seen);
}

// ---------- runs ----------

type Toggle = 'Accept' | 'Cancel';
const RESULT: Record<Toggle, Participation> = { Accept: 'Accepted', Cancel: 'Cancelled' };
const other = (a: Toggle): Toggle => (a === 'Accept' ? 'Cancel' : 'Accept');

/** One worker action; resolves once the server has answered (the page itself is optimistic). */
async function workerAct(worker: Page, action: Toggle): Promise<void> {
  const answered = worker.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/actions'),
  );
  await ui.actionButton(worker, action, AMARA).click();
  const res = await answered;
  if (!res.ok()) throw new Error(`${action} failed: ${res.status()} ${await res.text()}`);
}

/** Worker click → the manager's row shows the new status. */
async function updateDelay(manager: Page, worker: Page, action: Toggle): Promise<number> {
  const seen = await watch(ui.tracker(ui.managerWorker(manager, AMARA)), RESULT[action]);
  await workerAct(worker, action);
  const t1 = await seen();
  return t1 - (await lastClick(worker));
}

/** When the page's newest request to a URL containing `part` finished, on the page's clock. */
async function responseEnd(page: Page, part: string): Promise<number> {
  return page.evaluate((p) => {
    const entries = performance
      .getEntriesByType('resource')
      .filter((e) => e.name.includes(p)) as PerformanceResourceTiming[];
    return performance.timeOrigin + entries.at(-1)!.responseEnd;
  }, part);
}

/**
 * #94 The first action after the update path went cold: click → the worker's answer arrives, and
 * click → the manager's page shows it (the PostAction and Publisher cold starts both count).
 */
async function coldAction(manager: Page, worker: Page): Promise<{ answeredMs: number; seenMs: number }> {
  const seen = await watch(ui.tracker(ui.managerWorker(manager, AMARA)), RESULT.Accept);
  await workerAct(worker, 'Accept');
  const t1 = await seen();
  const t0 = await lastClick(worker);
  return { answeredMs: (await responseEnd(worker, '/actions')) - t0, seenMs: t1 - t0 };
}

/** #94 One snapshot read from the browser right after GetShift went cold (request → full response). */
async function coldSnapshot(page: Page): Promise<number> {
  return page.evaluate(async (url) => {
    const t0 = performance.now();
    const res = await fetch(url, { cache: 'no-store' });
    await res.json();
    return performance.now() - t0;
  }, `/api/shifts/${SHIFT_ID}`);
}

/** Outage off → the manager's page matches the server snapshot (row status and filled count). */
async function recoveryTime(manager: Page, worker: Page, first: Toggle): Promise<number> {
  await ui.outageSwitch(manager).click();
  await ui.expect(ui.outageSwitch(manager)).toBeChecked();
  let action = first;
  for (let i = 0; i < 3; i++) {
    await workerAct(worker, action);
    action = other(action);
  }
  const snap = await ui.serverSnapshot(worker.request);
  const amara = snap.workers.find((w) => w.name === AMARA)!;
  const participation = amara.participation === 'accepted' ? 'Accepted' : 'Cancelled';

  const seen = await watch(
    ui.tracker(ui.managerWorker(manager, AMARA)),
    participation,
    snap.shift.acceptedCount,
  );
  await ui.outageSwitch(manager).click();
  const t1 = await seen();
  const t0 = await lastClick(manager);
  await ui.waitForLive(manager);
  return t1 - t0;
}

// ---------- main ----------

async function main() {
  console.log(`Measuring against ${BASE_URL} (${STAGE ? 'stage' : 'local'})`);
  await resetShift();

  const browser = await chromium.launch();
  const managerCtx = await browser.newContext({ baseURL: BASE_URL });
  const workerCtx = await browser.newContext({ baseURL: BASE_URL });
  // tsx (esbuild keepNames) wraps named functions in `__name(...)`, which the page doesn't have.
  for (const ctx of [managerCtx, workerCtx]) await ctx.addInitScript('window.__name = (f) => f');
  const manager = await managerCtx.newPage();
  const worker = await workerCtx.newPage();
  await ui.openManager(manager);
  await ui.openWorker(worker, AMARA);
  await recordClicks(manager);
  await recordClicks(worker);

  await ui.actionButton(manager, 'Invite', AMARA).click();
  await ui.expectWorkerStatus(worker, 'Invited');

  // Cold starts: the first action and the first snapshot after their Lambdas were replaced.
  let coldStart: { ms: number; answeredMs: number; snapshotMs: number; note: string } | null = null;
  if (aws) {
    console.log('Forcing cold starts of GetShift, PostAction and Publisher…');
    await aws.forceColdStarts(['GetShift', 'PostAction', 'Publisher']);
    const snapshotMs = Math.round(await coldSnapshot(manager));
    const action = await coldAction(manager, worker);
    coldStart = {
      ms: Math.round(action.seenMs),
      answeredMs: Math.round(action.answeredMs),
      snapshotMs,
      note:
        'First Accept after PostAction and Publisher were forced cold (click → the manager sees it; ' +
        'answeredMs: click → the worker gets the answer), and one GET of the snapshot with GetShift ' +
        'cold. Not part of the percentiles.',
    };
    console.log(
      `Cold first action: ${coldStart.ms} ms to the manager (answered in ${coldStart.answeredMs} ms)`,
    );
    console.log(`Cold first snapshot: ${coldStart.snapshotMs} ms`);
    if (args['cold-only']) {
      await browser.close();
      return;
    }
  } else {
    await workerAct(worker, 'Accept'); // local mode has no cold starts; just get to Accepted
  }
  await ui.expectManagerStatus(manager, AMARA, 'Accepted');
  await sleep(PAUSE_MS);
  // CloudWatch aggregates by whole minutes: start on a minute boundary so the per-hop window
  // holds exactly the measured actions (not the invite or the cold start).
  if (aws) await sleep(60_000 - (Date.now() % 60_000) + 100);

  const start = new Date();
  const delays: number[] = [];
  let action: Toggle = 'Cancel';
  for (let i = 0; i < RUNS; i++) {
    delays.push(await updateDelay(manager, worker, action));
    if ((i + 1) % 10 === 0)
      console.log(`update delay ${i + 1}/${RUNS}: last ${Math.round(delays.at(-1)!)} ms`);
    action = other(action);
    await sleep(PAUSE_MS);
  }

  const recoveries: number[] = [];
  for (let i = 0; i < RECOVERY_RUNS; i++) {
    recoveries.push(await recoveryTime(manager, worker, action));
    // Three actions flip the state once, so the next run starts with the opposite action.
    action = other(action);
    console.log(`recovery ${i + 1}/${RECOVERY_RUNS}: ${Math.round(recoveries.at(-1)!)} ms`);
    await sleep(PAUSE_MS);
  }
  const end = new Date();
  const browserVersion = browser.version();
  await browser.close();

  let perHop: Record<string, unknown> | null = null;
  let throttling: Record<string, number> | null = null;
  if (aws) {
    console.log('Reading per-hop metrics from CloudWatch (EMF can take a few minutes to land)…');
    const dims = [{ Name: 'service', Value: 'live-staffing' }];
    // Every measured action: RUNS update-delay actions and 3 per recovery run.
    const expected = RUNS + 3 * RECOVERY_RUNS;
    perHop = {};
    for (const name of ['CommandDuration', 'CommitToPublisher', 'PublishDuration']) {
      perHop[name] = await aws.metricStats('LiveStaffing', name, dims, start, end, expected);
    }
    throttling = await aws.tableThrottles(start, end);
  }

  const cpus = os.cpus();
  const result = {
    target: STAGE ? 'stage' : 'local',
    baseUrl: BASE_URL,
    measuredAt: start.toISOString(),
    durationS: Math.round((end.getTime() - start.getTime()) / 1000),
    machine: {
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      cpu: `${cpus[0]?.model.trim()} × ${cpus.length}`,
      memoryGb: Math.round(os.totalmem() / 2 ** 30),
      node: process.version,
      browser: `Chromium ${browserVersion} (headless)`,
    },
    conditions:
      args.conditions ||
      (STAGE
        ? `Sequential runs, ${PAUSE_MS} ms apart, browser on this machine → ca-central-1`
        : `Sequential runs, ${PAUSE_MS} ms apart, docker compose local mode on this machine`),
    updateDelayMs: { ...summarize(delays), samples: delays.map(Math.round) },
    recoveryMs: { ...summarize(recoveries), samples: recoveries.map(Math.round) },
    coldStart,
    perHopMs: perHop,
    throttling,
  };

  const dir = new URL('../results/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`${result.target}.json`, dir);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Update delay p50 ${result.updateDelayMs.p50} ms, p95 ${result.updateDelayMs.p95} ms`);
  console.log(`Recovery p50 ${result.recoveryMs.p50} ms, p95 ${result.recoveryMs.p95} ms`);
  console.log(`Wrote ${fileURLToPath(file)}. Run \`pnpm measure:render\` to update the README table.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
