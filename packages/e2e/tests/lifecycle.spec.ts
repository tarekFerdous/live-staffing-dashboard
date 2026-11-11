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

const AMARA = WORKERS.amara;

test('full lifecycle: invite, accept, check in, check out, live across two sessions', async ({
  manager,
  workerPage,
}) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);

  await expectCounts(manager, { filled: 0 });
  await expectManagerStatus(manager, AMARA, 'Uninvited');
  await expectWorkerStatus(workerPage, 'Uninvited');
  await expect(workerPage.getByText("You haven't been invited to this shift yet.")).toBeVisible();

  // Manager invites: the worker's page updates without a refresh.
  await actionButton(manager, 'Invite', AMARA).click();
  await expectManagerStatus(manager, AMARA, 'Invited');
  await expectWorkerStatus(workerPage, 'Invited');

  // Worker accepts: the manager's page and counts update.
  await actionButton(workerPage, 'Accept', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted');
  await expectManagerStatus(manager, AMARA, 'Accepted');
  await expectCounts(manager, { filled: 1 });

  await actionButton(workerPage, 'Check in', AMARA).click();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');
  await expectCounts(manager, { filled: 1, checkedIn: 1 });

  await actionButton(workerPage, 'Check out', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted', 'Checked out');
  await expect(workerPage.getByText("You've checked out. This shift is complete.")).toBeVisible();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked out');
  await expectCounts(manager, { filled: 1, checkedIn: 0, checkedOut: 1 });

  // Checked out is final: the worker has no buttons left.
  await expect(workerPage.getByRole('button', { name: new RegExp(AMARA) })).toHaveCount(0);

  // The timeline shows every step, newest first.
  await expect(timelineEntries(manager)).toHaveText([
    /Amara Okafor checked out/,
    /Amara Okafor checked in/,
    /Amara Okafor accepted/,
    /Manager invited Amara Okafor/,
  ]);
});

test('state survives a refresh of both pages', async ({ manager, workerPage }) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);

  await actionButton(manager, 'Invite', AMARA).click();
  await actionButton(workerPage, 'Accept', AMARA).click();
  await actionButton(workerPage, 'Check in', AMARA).click();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');

  await manager.reload();
  await workerPage.reload();

  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');
  await expectCounts(manager, { filled: 1, checkedIn: 1 });
  // The worker page remembers who the worker is.
  await expectWorkerStatus(workerPage, 'Accepted', 'Checked in');
  await expect(timelineEntries(manager)).toHaveCount(3);
});
