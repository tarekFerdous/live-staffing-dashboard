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

/** A loaded, decorative, round photo of about `size` px, served by the app as webp. */
async function expectWorkerPhoto(page: Page, photo: Locator, size: number) {
  await expect(photo).toHaveJSProperty('complete', true);
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(await photo.getAttribute('alt')).toBe('');
  const b = await box(photo);
  expect(Math.abs(b.width - size)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.height - size)).toBeLessThanOrEqual(1);
  expect(await photo.evaluate((img) => getComputedStyle(img).borderRadius)).not.toBe('0px');
  const res = await page.request.get(new URL((await photo.getAttribute('src'))!, page.url()).href);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/webp');
}

test("every worker card's header shows that worker's own 32 px photo", async ({ manager, workerPage }) => {
  await openManager(manager);
  const srcs = new Set<string>();
  for (const name of Object.values(WORKERS)) {
    const photo = managerWorker(manager, name).locator('header img');
    await expectWorkerPhoto(manager, photo, 32);
    srcs.add((await photo.getAttribute('src'))!);
  }
  expect(srcs.size).toBe(3);

  // The worker's own status card on the Worker page too.
  await openWorker(workerPage, WORKERS.liam);
  const own = workerPage.getByRole('region', { name: /^Liam Chen, your status/ }).locator('header img');
  await expectWorkerPhoto(workerPage, own, 32);
});

test("the Worker profile shows the chosen worker's 64 px photo left of their name", async ({
  workerPage,
}) => {
  await openWorker(workerPage, WORKERS.amara);
  const profile = workerPage.getByTestId('my-profile');
  for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
    await workerPage.setViewportSize({ width, height: 900 });
    const photo = profile.getByTestId('worker-photo');
    await expectWorkerPhoto(workerPage, photo, 64);
    const p = await box(photo);
    const name = await box(profile.getByRole('heading', { name: WORKERS.amara }));
    expect(p.x + p.width).toBeLessThanOrEqual(name.x);
    // Same row: the name sits within the photo's height.
    expect(name.y).toBeGreaterThanOrEqual(p.y - 1);
    expect(name.y + name.height).toBeLessThanOrEqual(p.y + p.height + 1);
    await expectNoSideScroll(workerPage);
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

test('both pages use the bundled Geist font', async ({ manager, workerPage }) => {
  await openManager(manager);
  await openWorker(workerPage, WORKERS.amara);
  for (const page of [manager, workerPage]) {
    const font = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        family: getComputedStyle(document.body).fontFamily,
        check: document.fonts.check('16px "Geist Variable"'),
        loaded: Array.from(document.fonts as unknown as Iterable<FontFace>).some(
          (f) => f.family.replace(/"/g, '') === 'Geist Variable' && f.status === 'loaded',
        ),
      };
    });
    expect(font.family).toMatch(/^"?Geist Variable"?,/);
    expect(font.check).toBe(true);
    expect(font.loaded).toBe(true);
  }
});

/**
 * The backdrop gradient's stops (WCAG luminance and HSL saturation), the cards' alpha and border,
 * and the active nav tab's and first primary button's background colours.
 */
const look = (page: Page) =>
  page.evaluate(() => {
    const lum = (rgb: number[]) =>
      rgb
        .map((v) => v / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    const sat = (rgb: number[]) => {
      const [max, min] = [Math.max(...rgb) / 255, Math.min(...rgb) / 255];
      const l = (max + min) / 2;
      return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    };
    const rgbOf = (el: Element | null) =>
      el
        ? /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(el).backgroundColor)!.slice(1, 4).map(Number)
        : null;
    const stops = [
      ...getComputedStyle(document.body).backgroundImage.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g),
    ].map((m) => m.slice(1, 4).map(Number));
    const cards = Array.from(document.querySelectorAll('main .card')).map((el) => {
      const s = getComputedStyle(el);
      const alpha = /rgba?\([^)]*,\s*([\d.]+)\)/.exec(s.backgroundColor)?.[1];
      return {
        alpha: alpha === undefined ? 1 : Number(alpha),
        border: s.borderTopWidth,
        style: s.borderTopStyle,
      };
    });
    const ink = [
      rgbOf(document.querySelector('nav[aria-label="Main"] [aria-current="page"]')),
      rgbOf(document.querySelector('main .btn-primary')),
    ].map((rgb) => (rgb ? { lum: lum(rgb), sat: sat(rgb) } : null));
    return { backdrop: stops.map(lum), backdropSat: stops.map(sat), cards, ink };
  });

test('dark mode is Hark dusk: a mid-tone backdrop and borderless glass cards', async ({
  browser,
  manager,
}) => {
  const expectDusk = async (page: Page) => {
    const { backdrop, cards } = await look(page);
    expect(backdrop).toHaveLength(2);
    for (const l of backdrop) {
      expect(l).toBeGreaterThan(0.06);
      expect(l).toBeLessThan(0.3);
    }
    expect(cards.length).toBeGreaterThan(3);
    for (const c of cards) {
      expect(c.alpha).toBeLessThan(1);
      expect(c.border === '0px' || c.style === 'none').toBe(true);
    }
  };

  // Chosen explicitly (stored preference), with a light OS.
  await openManager(manager);
  await manager.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await expectDusk(manager);

  // Followed from a dark OS (System).
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await openManager(page);
  await expectDusk(page);
  await ctx.close();
});

test('light mode is Hark day: a light tinted backdrop, slate-ink primary, borderless glass cards', async ({
  browser,
  manager,
}) => {
  const expectDay = async (page: Page) => {
    const { backdrop, backdropSat, cards, ink } = await look(page);
    expect(backdrop).toHaveLength(2);
    for (const l of backdrop) expect(l).toBeGreaterThan(0.6);
    for (const s of backdropSat) expect(s).toBeGreaterThan(0.12);
    expect(cards.length).toBeGreaterThan(3);
    for (const c of cards) {
      expect(c.alpha).toBeLessThan(1);
      expect(c.border === '0px' || c.style === 'none').toBe(true);
    }
    // The active nav tab and a primary button: dark slate ink, tinted, not neutral black.
    for (const i of ink) {
      expect(i).not.toBeNull();
      expect(i!.lum).toBeLessThan(0.06);
      expect(i!.sat).toBeGreaterThan(0.15);
    }
  };

  // Followed from a light OS (System).
  await openManager(manager);
  await expectDay(manager);

  // Chosen explicitly (stored preference), with a dark OS.
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  const page = await ctx.newPage();
  await openManager(page);
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  // Buttons and the nav tab fade their background (150 ms); measure once the fades are done.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await expectDay(page);
  await ctx.close();
});

test('text uses only Regular (400) and Medium (500)', async ({ manager, workerPage }) => {
  await openManager(manager);
  await actionButton(manager, 'Invite', WORKERS.amara).click();
  await openWorker(workerPage, WORKERS.amara);
  await actionButton(workerPage, 'Accept', WORKERS.amara).click();
  await expectManagerStatus(manager, WORKERS.amara, 'Accepted');

  const weight = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).fontWeight));
  for (const page of [manager, workerPage]) {
    const key = [
      page.getByTestId('shift-time'),
      shiftCard(page).getByRole('heading').first(),
      page.getByRole('button', { name: /^Theme/ }),
      page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]'),
    ];
    if (page === manager) key.push(manager.getByTestId('count-filled'));
    for (const l of key) expect([400, 500]).toContain(await weight(l));

    const heavy = await page.locator('main').evaluate((main) =>
      Array.from(main.querySelectorAll('*'))
        .filter((el) => (el as HTMLElement).offsetParent !== null || el instanceof SVGElement)
        .filter((el) => Number(getComputedStyle(el).fontWeight) > 500)
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(heavy).toEqual([]);
  }
});
