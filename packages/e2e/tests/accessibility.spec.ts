import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  actionButton,
  expect,
  expectWorkerStatus,
  managerWorker,
  openManager,
  openWorker,
  test,
  tracker,
  WORKERS,
  workerPicker,
} from '../lib/app';

/** WCAG 2.1 A/AA rules checked by axe-core (contrast included). */
async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function expectNoSideScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('both pages pass axe and fit 400 px without scrolling sideways', async ({ manager, workerPage }) => {
      await openManager(manager);
      await openWorker(workerPage, WORKERS.amara);
      expect(await manager.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
        colorScheme === 'dark',
      );
      // Every tint at once: accepted (green), checked in (amber), declined (red stop).
      for (const name of Object.values(WORKERS)) await actionButton(manager, 'Invite', name).click();
      await actionButton(workerPage, 'Accept', WORKERS.amara).click();
      await expectWorkerStatus(workerPage, 'Accepted');
      await openWorker(workerPage, WORKERS.liam);
      await actionButton(workerPage, 'Accept', WORKERS.liam).click();
      await actionButton(workerPage, 'Check in', WORKERS.liam).click();
      await expectWorkerStatus(workerPage, 'Accepted', 'Checked in');
      await openWorker(workerPage, WORKERS.sofia);
      await actionButton(workerPage, 'Decline', WORKERS.sofia).click();
      await expect(tracker(managerWorker(manager, WORKERS.sofia))).toHaveText('Step 2 of 4: Declined');
      for (const [name, tone] of [
        [WORKERS.amara, 'good'],
        [WORKERS.liam, 'warn'],
        [WORKERS.sofia, 'bad'],
      ] as const)
        await expect(managerWorker(manager, name)).toHaveAttribute('data-tone', tone);
      await openWorker(workerPage, WORKERS.amara);

      // An error toast: the server refuses the next action.
      await workerPage.route('**/workers/*/actions', (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'CONFLICT', message: 'That change was refused.' }),
        }),
      );
      await actionButton(workerPage, 'Check in', WORKERS.amara).click();
      await expect(workerPage.getByText('That change was refused.')).toBeVisible();
      await expectNoViolations(workerPage);
      await workerPage.unroute('**/workers/*/actions');

      // The worker picker's menu, open.
      await workerPicker(workerPage).click();
      await expect(workerPage.getByRole('listbox')).toBeVisible();
      await expectNoViolations(workerPage);
      await workerPage.keyboard.press('Escape');
      await expect(workerPage.getByRole('listbox')).toBeHidden();

      for (const page of [manager, workerPage]) {
        await expectNoViolations(page);
        await page.setViewportSize({ width: 400, height: 800 });
        await expectNoSideScroll(page);
        await expectNoViolations(page);
      }
    });
  });
}

test('every card is a labelled region and every control is reachable by keyboard', async ({ manager }) => {
  await openManager(manager);
  for (const name of ['Staffing', 'Activity', ...Object.values(WORKERS)]) {
    await expect(manager.getByRole('region', { name, exact: true })).toBeVisible();
  }
  await expect(manager.getByRole('figure', { name: /No changes yet|Filled went/ })).toBeVisible();

  // Visible ones only: the closed Reset demo dialog's buttons can't be reached, by design.
  const controls = await manager
    .locator('a[href], button, select, [role="switch"]')
    .filter({ visible: true })
    .count();
  const reached = new Set<string>();
  for (let i = 0; i < controls + 3; i++) {
    await manager.keyboard.press('Tab');
    const id = await manager.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Focus must be visible: the focus ring is an outline.
      if (getComputedStyle(el).outlineStyle === 'none') return `invisible:${el.outerHTML.slice(0, 80)}`;
      // Count elements, not markup: look-alike controls (unselected tiles) share their HTML.
      const w = window as unknown as { __ids?: WeakMap<Element, number>; __n?: number };
      w.__ids ??= new WeakMap();
      if (!w.__ids.has(el)) w.__ids.set(el, (w.__n = (w.__n ?? 0) + 1));
      return `#${w.__ids.get(el)} ${el.outerHTML.slice(0, 80)}`;
    });
    if (id) reached.add(id);
  }
  expect([...reached].filter((r) => r.startsWith('invisible:'))).toEqual([]);
  expect(reached.size).toBeGreaterThanOrEqual(controls);
});
