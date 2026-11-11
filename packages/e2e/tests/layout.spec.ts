import type { Locator, Page } from '@playwright/test';
import {
  actionButton,
  expect,
  expectManagerStatus,
  managerWorker,
  openManager,
  openWorker,
  test,
  timelineEntries,
  WORKERS,
} from '../lib/app';

const WIDTHS = { phone: 400, laptop: 1024, desktop: 1440, wide: 1920 } as const;

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return b;
}

async function expectNoSideScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

const activity = (page: Page) => page.getByRole('region', { name: 'Activity', exact: true });
const staffing = (page: Page) => page.getByRole('region', { name: 'Staffing', exact: true });
const lastWorker = (page: Page) => managerWorker(page, WORKERS.sofia);

const shiftCard = (page: Page) => page.getByRole('region', { name: /Winter Gala/ });

test('the Shift card photo fills the free height, with the details at the bottom', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await manager.setViewportSize({ width: WIDTHS.desktop, height: 900 });
  const card = shiftCard(manager);
  const photo = card.locator('img');
  await expect(photo).toHaveJSProperty('complete', true);
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(await photo.getAttribute('alt')).toBe('');

  // Served by the app itself as webp.
  const res = await manager.request.get(new URL((await photo.getAttribute('src'))!, manager.url()).href);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/webp');

  // No empty block: the photo ends where the details start, and they end at the card's bottom.
  const c = await box(card);
  const media = await box(card.getByTestId('card-media'));
  const time = await box(card.getByTestId('shift-time'));
  const details = await box(card.locator('dl'));
  expect(media.height).toBeGreaterThanOrEqual(159);
  expect(time.y - (media.y + media.height)).toBeLessThanOrEqual(17);
  expect(c.y + c.height - (details.y + details.height)).toBeLessThanOrEqual(21);
  // It stretches with the Staffing card next to it.
  const s = await box(staffing(manager));
  expect(Math.abs(c.height - s.height)).toBeLessThanOrEqual(1);

  // On phones and on the wide Worker-page card it keeps about 160 px.
  await openWorker(workerPage, WORKERS.amara);
  for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
    await workerPage.setViewportSize({ width, height: 900 });
    const m = await box(shiftCard(workerPage).getByTestId('card-media'));
    expect(m.height).toBeGreaterThanOrEqual(159);
  }
});

test('the shared layout spans the full width with lined-up gutters and no side scroll', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await openWorker(workerPage, WORKERS.amara);
  for (const page of [manager, workerPage]) {
    for (const width of Object.values(WIDTHS)) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoSideScroll(page);
      const header = await box(page.locator('header > div').first());
      const main = await box(page.locator('main'));
      // Header and main content share the same side gutters.
      expect(Math.abs(header.x - main.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(header.x + header.width - (main.x + main.width))).toBeLessThanOrEqual(1);
    }
  }

  // At 1920 the content fills the viewport except a gutter of at most 32 px a side.
  await manager.setViewportSize({ width: WIDTHS.wide, height: 900 });
  const content = await box(manager.locator('main > *').last());
  expect(content.x).toBeLessThanOrEqual(32);
  expect(content.width).toBeGreaterThanOrEqual(WIDTHS.wide - 64 - 1);
});

test('the "Live paused" notice uses the same gutters', async ({ manager }) => {
  await openManager(manager);
  await manager.setViewportSize({ width: WIDTHS.wide, height: 900 });
  await manager.getByRole('switch', { name: 'Simulate outage' }).click();
  const notice = manager.getByText(/Live updates are paused|You're offline/);
  await expect(notice).toBeVisible();
  const n = await box(notice);
  const main = await box(manager.locator('main'));
  expect(Math.abs(n.x - main.x - 32)).toBeLessThanOrEqual(1);
  expect(n.width).toBeGreaterThanOrEqual(WIDTHS.wide - 64 - 1);
});

test('at xl Activity is a sticky rail on the right; below xl it sits under the workers', async ({
  manager,
}) => {
  await openManager(manager);
  await expect(manager.getByRole('list', { name: 'Activity, newest first' })).toHaveCount(0);
  await actionButton(manager, 'Invite', WORKERS.amara).click();
  await expect(manager.getByRole('list', { name: 'Activity, newest first' })).toHaveCount(1);

  // Short viewport so the page scrolls.
  await manager.setViewportSize({ width: WIDTHS.desktop, height: 500 });
  const rail = await box(activity(manager));
  for (const card of [
    staffing(manager),
    manager.getByRole('region', { name: /Winter Gala/ }),
    lastWorker(manager),
  ]) {
    const b = await box(card);
    expect(rail.x).toBeGreaterThan(b.x + b.width);
  }
  // Staffing (2 columns) + Shift (1) on the first row; workers three per row.
  const amara = await box(managerWorker(manager, WORKERS.amara));
  const liam = await box(managerWorker(manager, WORKERS.liam));
  const sofia = await box(lastWorker(manager));
  expect(Math.abs(amara.y - sofia.y)).toBeLessThanOrEqual(1);
  expect(liam.x).toBeGreaterThan(amara.x);
  expect(sofia.x).toBeGreaterThan(liam.x);

  await manager.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await manager.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const stuck = await box(activity(manager));
  expect(stuck.y).toBeGreaterThanOrEqual(0);
  expect(stuck.y + stuck.height).toBeLessThanOrEqual(500);

  for (const width of [WIDTHS.laptop, WIDTHS.phone]) {
    await manager.setViewportSize({ width, height: 900 });
    const a = await box(activity(manager));
    const w = await box(lastWorker(manager));
    expect(a.y).toBeGreaterThan(w.y + w.height);
    await expect(manager.getByRole('list', { name: 'Activity, newest first' })).toHaveCount(1);
  }
});

test('at xl a long Activity list scrolls inside the rail, by keyboard too', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  for (const name of Object.values(WORKERS)) await actionButton(manager, 'Invite', name).click();
  await openWorker(workerPage, WORKERS.amara);
  for (const a of ['Accept', 'Check in', 'Check out'] as const) {
    await actionButton(workerPage, a, WORKERS.amara).click();
  }
  await openWorker(workerPage, WORKERS.liam);
  await actionButton(workerPage, 'Accept', WORKERS.liam).click();
  await openWorker(workerPage, WORKERS.sofia);
  await actionButton(workerPage, 'Decline', WORKERS.sofia).click();
  await expectManagerStatus(manager, WORKERS.sofia, 'Declined');
  await expect(timelineEntries(manager)).toHaveCount(8);

  const height = 420;
  await manager.setViewportSize({ width: WIDTHS.desktop, height });
  const list = manager.getByRole('list', { name: 'Activity, newest first' });
  const rail = await box(activity(manager));
  expect(rail.height).toBeLessThanOrEqual(height);
  const sizes = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);

  // The page doesn't grow because of the list: its height matches the main grid's tallest column.
  const pageHeight = await manager.evaluate(() => document.documentElement.scrollHeight);
  const last = await box(lastWorker(manager));
  const scrollY = await manager.evaluate(() => window.scrollY);
  expect(pageHeight).toBeLessThanOrEqual(scrollY + last.y + last.height + 64);

  await list.focus();
  await expect(list).toBeFocused();
  await manager.keyboard.press('End');
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('the tracker fill ends under its step label, with the knob inside the bar', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await openWorker(workerPage, WORKERS.amara);
  const card = managerWorker(manager, WORKERS.amara);
  const knob = card.getByTestId('tracker-knob');
  const fill = card.getByTestId('tracker-fill');
  const bar = fill.locator('..');

  async function expectAt(label: string, full = false) {
    // Wait out the 300 ms width transition.
    await expect.poll(async () => (await box(fill)).width).toBeGreaterThan(0);
    await manager.waitForTimeout(400);
    const b = await box(bar);
    const f = await box(fill);
    const k = await box(knob);
    // The step label under the bar (not the header's status of the same name).
    const l = await box(
      bar.locator('xpath=following-sibling::ol[1]/li').filter({ hasText: new RegExp(`^${label}$`) }),
    );
    const end = f.x + f.width;
    if (full) expect(Math.abs(end - (b.x + b.width))).toBeLessThanOrEqual(1);
    else expect(Math.abs(end - (l.x + l.width / 2))).toBeLessThanOrEqual(2);
    // The knob never pokes out of the bar's ends.
    expect(k.x).toBeGreaterThanOrEqual(b.x - 0.5);
    expect(k.x + k.width).toBeLessThanOrEqual(b.x + b.width + 0.5);
    expect(k.height).toBeGreaterThan(b.height);
  }

  await actionButton(manager, 'Invite', WORKERS.amara).click();
  await expectManagerStatus(manager, WORKERS.amara, 'Invited');
  await expectAt('Invited');
  for (const [action, label] of [
    ['Accept', 'Accepted'],
    ['Check in', 'Checked in'],
  ] as const) {
    await actionButton(workerPage, action, WORKERS.amara).click();
    await expect(card.getByTestId('tracker')).toContainText(label);
    await expectAt(label);
  }
  await actionButton(workerPage, 'Check out', WORKERS.amara).click();
  await expect(card.getByTestId('tracker')).toContainText('Checked out');
  await expectAt('Checked out', true);
});

test('a card tint fades in about 300 ms, and not at all with reduced motion', async ({
  browser,
  manager,
}) => {
  await openManager(manager);
  const duration = (page: Page) =>
    managerWorker(page, WORKERS.amara).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(await duration(manager)).toBe('0.3s');

  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const calm = await ctx.newPage();
  await openManager(calm);
  expect(await duration(calm)).toBe('0s');
  await ctx.close();
});
