import type { Page } from '@playwright/test';
import {
  actionButton,
  expect,
  expectCounts,
  expectManagerStatus,
  expectWorkerStatus,
  openManager,
  openWorker,
  outageSwitch,
  test,
  timelineEntries,
  waitForLive,
  WORKERS,
} from '../lib/app';

const AMARA = WORKERS.amara;

test('three changes made during a manager outage all appear after reconnecting', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);

  await actionButton(manager, 'Invite', AMARA).click();
  await expectWorkerStatus(workerPage, 'Invited');

  // The manager loses its live connection; actions there are turned off meanwhile.
  await outageSwitch(manager).click();
  await expect(outageSwitch(manager)).toBeChecked();
  await expect(manager.getByRole('status', { name: 'Connection: Live' })).toHaveCount(0);

  await actionButton(workerPage, 'Accept', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted');
  await actionButton(workerPage, 'Check in', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted', 'Checked in');
  await actionButton(workerPage, 'Check out', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted', 'Checked out');

  // Still showing the old state while disconnected.
  await expectManagerStatus(manager, AMARA, 'Invited');
  await expectCounts(manager, { filled: 0 });

  await outageSwitch(manager).click();
  await waitForLive(manager);

  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked out');
  await expectCounts(manager, { filled: 1, checkedOut: 1 });
  await expect(timelineEntries(manager)).toHaveText([
    /Amara Okafor checked out/,
    /Amara Okafor checked in/,
    /Amara Okafor accepted/,
    /Manager invited Amara Okafor/,
  ]);
});

/** Emulates the tab being hidden or shown again (switching tabs, minimising the window). */
async function setTabVisible(page: Page, visible: boolean) {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (v ? 'visible' : 'hidden'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

test('a hidden manager tab pauses live sync, and catches up as soon as it is shown again (#93)', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);
  await actionButton(manager, 'Invite', AMARA).click();
  await expectWorkerStatus(workerPage, 'Invited');

  const reads: string[] = [];
  manager.on('request', (r) => {
    if (r.url().includes('/events')) reads.push(r.url());
  });
  await setTabVisible(manager, false);
  await expect(manager.getByRole('status', { name: 'Connection: Live' })).toHaveCount(0);

  await actionButton(workerPage, 'Accept', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted');
  // Long enough for a push to have arrived on a visible page.
  await manager.waitForTimeout(2_000);
  await expectManagerStatus(manager, AMARA, 'Invited');
  expect(reads).toEqual([]); // a hidden tab makes no requests

  await setTabVisible(manager, true);
  await waitForLive(manager);
  await expectManagerStatus(manager, AMARA, 'Accepted');
  await expectCounts(manager, { filled: 1 });
});
