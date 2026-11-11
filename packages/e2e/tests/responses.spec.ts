import {
  actionButton,
  expect,
  expectCounts,
  expectManagerStatus,
  expectWorkerStatus,
  openManager,
  openWorker,
  test,
  timelineEntries,
  WORKERS,
} from '../lib/app';

const LIAM = WORKERS.liam;

test('decline, re-invite, accept, cancel and accept again', async ({ manager, workerPage }) => {
  await openManager(manager);
  await openWorker(workerPage, LIAM);

  await actionButton(manager, 'Invite', LIAM).click();
  await expectWorkerStatus(workerPage, 'Invited');

  // Decline: the manager sees it and can invite again.
  await actionButton(workerPage, 'Decline', LIAM).click();
  await expectWorkerStatus(workerPage, 'Declined');
  await expect(
    workerPage.getByText('You declined this shift. The manager can invite you again.'),
  ).toBeVisible();
  await expectManagerStatus(manager, LIAM, 'Declined');
  await expectCounts(manager, { filled: 0 });

  await actionButton(manager, 'Invite', LIAM).click();
  await expectWorkerStatus(workerPage, 'Invited');

  await actionButton(workerPage, 'Accept', LIAM).click();
  await expectManagerStatus(manager, LIAM, 'Accepted');
  await expectCounts(manager, { filled: 1 });

  // Cancel frees the place.
  await actionButton(workerPage, 'Cancel', LIAM).click();
  await expectWorkerStatus(workerPage, 'Cancelled');
  await expectManagerStatus(manager, LIAM, 'Cancelled');
  await expectCounts(manager, { filled: 0 });

  // A cancelled worker may accept again while there is room.
  await actionButton(workerPage, 'Accept', LIAM).click();
  await expectManagerStatus(manager, LIAM, 'Accepted');
  await expectCounts(manager, { filled: 1 });

  await expect(timelineEntries(manager)).toHaveText([
    /Liam Chen accepted/,
    /Liam Chen cancelled/,
    /Liam Chen accepted/,
    /Manager invited Liam Chen/,
    /Liam Chen declined/,
    /Manager invited Liam Chen/,
  ]);
});

test('only the actions allowed from the current state are offered', async ({ manager, workerPage }) => {
  await openManager(manager);
  await openWorker(workerPage, LIAM);

  // Uninvited: the manager can invite; the worker can do nothing.
  await expect(actionButton(manager, 'Invite', LIAM)).toBeVisible();
  await expect(workerPage.getByRole('button', { name: new RegExp(LIAM) })).toHaveCount(0);

  await actionButton(manager, 'Invite', LIAM).click();
  // Invited: no second invite; the worker may accept or decline but not check in.
  await expect(actionButton(manager, 'Invite', LIAM)).toHaveCount(0);
  await expect(actionButton(workerPage, 'Accept', LIAM)).toBeVisible();
  await expect(actionButton(workerPage, 'Decline', LIAM)).toBeVisible();
  await expect(actionButton(workerPage, 'Check in', LIAM)).toHaveCount(0);
  await expect(actionButton(workerPage, 'Check out', LIAM)).toHaveCount(0);

  await actionButton(workerPage, 'Accept', LIAM).click();
  // Accepted: check in or cancel, never check out before checking in.
  await expect(actionButton(workerPage, 'Check in', LIAM)).toBeVisible();
  await expect(actionButton(workerPage, 'Cancel', LIAM)).toBeVisible();
  await expect(actionButton(workerPage, 'Check out', LIAM)).toHaveCount(0);

  await actionButton(workerPage, 'Check in', LIAM).click();
  // Checked in: only check out; cancelling is no longer possible.
  await expect(actionButton(workerPage, 'Check out', LIAM)).toBeVisible();
  await expect(actionButton(workerPage, 'Cancel', LIAM)).toHaveCount(0);
});
