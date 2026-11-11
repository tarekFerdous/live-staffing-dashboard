import type { Page } from '@playwright/test';
import { resetShift } from '../lib/env';
import {
  actionButton,
  expect,
  expectCounts,
  expectManagerStatus,
  expectWorkerProfile,
  expectWorkerStatus,
  openManager,
  openWorker,
  test,
  timelineEntries,
  waitForLive,
  WORKERS,
} from '../lib/app';

const AMARA = WORKERS.amara;
const LIAM = WORKERS.liam;

/** Some history on both pages: Amara checked in, Liam invited. */
async function makeChanges(manager: Page, worker: Page) {
  await actionButton(manager, 'Invite', AMARA).click();
  await actionButton(manager, 'Invite', LIAM).click();
  await actionButton(worker, 'Accept', AMARA).click();
  await actionButton(worker, 'Check in', AMARA).click();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');
  await expectCounts(manager, { filled: 1, checkedIn: 1 });
  await expect(timelineEntries(manager)).toHaveCount(4);
}

async function expectSeeded(manager: Page, worker: Page) {
  for (const name of Object.values(WORKERS)) await expectManagerStatus(manager, name, 'Uninvited');
  await expectCounts(manager, { filled: 0 });
  await expect(manager.getByText('No activity yet.')).toBeVisible();
  await expectWorkerStatus(worker, 'Uninvited');
  await expect(worker.getByText("You haven't been invited to this shift yet.")).toBeVisible();
}

const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset demo', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Reset demo?' });

test('a reset from the manager modal puts both open pages back to the seed without a refresh', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);
  await expectWorkerProfile(workerPage, AMARA);
  await makeChanges(manager, workerPage);

  await resetButton(manager).click();
  await expect(dialog(manager)).toBeVisible();
  await expect(dialog(manager).getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog(manager).getByRole('button', { name: 'Reset demo' }).click();

  await expect(dialog(manager)).toBeHidden();
  await expect(manager.getByText('Demo reset')).toBeVisible();
  await expectSeeded(manager, workerPage);
  // The details come back with the seed, live and after a reload.
  await expectWorkerProfile(workerPage, AMARA);
  await workerPage.reload();
  await expectWorkerProfile(workerPage, AMARA);
  await waitForLive(workerPage);

  // Both pages keep working live from the fresh start.
  await actionButton(manager, 'Invite', AMARA).click();
  await expectWorkerStatus(workerPage, 'Invited');
  await expect(timelineEntries(manager)).toHaveText([/Manager invited Amara Okafor/]);
});

test('cancelling the modal leaves everything as it was', async ({ manager, workerPage }) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);
  await makeChanges(manager, workerPage);

  await resetButton(manager).click();
  await dialog(manager).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(manager)).toBeHidden();
  await expect(resetButton(manager)).toBeFocused();

  await resetButton(manager).click();
  await manager.keyboard.press('Escape');
  await expect(dialog(manager)).toBeHidden();

  // Give a stray request time to land, then check nothing changed.
  await manager.waitForTimeout(1_000);
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');
  await expectCounts(manager, { filled: 1, checkedIn: 1 });
  await expectWorkerStatus(workerPage, 'Accepted', 'Checked in');
});

test('`pnpm reset` from a terminal resets open pages too', async ({ manager, workerPage }) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);
  await makeChanges(manager, workerPage);

  await resetShift();
  await expectSeeded(manager, workerPage);
});
