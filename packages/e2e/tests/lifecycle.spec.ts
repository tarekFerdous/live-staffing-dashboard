import {
  actionButton,
  chartCaption,
  expect,
  expectCounts,
  expectManagerStatus,
  expectTone,
  expectWorkerStatus,
  openManager,
  openWorker,
  staffingTile,
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
  await expectTone(manager, AMARA, 'none');

  // Worker accepts: the manager's page and counts update.
  await actionButton(workerPage, 'Accept', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted');
  await expectManagerStatus(manager, AMARA, 'Accepted');
  await expectCounts(manager, { filled: 1 });
  // Status tints, live: green once accepted.
  await expectTone(manager, AMARA, 'good');

  await actionButton(workerPage, 'Check in', AMARA).click();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');
  await expectCounts(manager, { filled: 1, checkedIn: 1 });
  await expectTone(manager, AMARA, 'warn');
  // The worker's own card is never tinted.
  await expect(workerPage.getByRole('region', { name: `${AMARA}, your status` })).not.toHaveAttribute(
    'data-tone',
  );

  // The Staffing chart follows the selected tile: Filled by default, then Checked in.
  await expect(staffingTile(manager, 'Filled')).toHaveAttribute('aria-pressed', 'true');
  await expect(chartCaption(manager)).toHaveText(/^Filled went from 0 to 1 /);
  await staffingTile(manager, 'Checked in').click();
  await expect(staffingTile(manager, 'Checked in')).toHaveAttribute('aria-pressed', 'true');
  await expect(staffingTile(manager, 'Filled')).toHaveAttribute('aria-pressed', 'false');
  await expect(chartCaption(manager)).toHaveText(/^Checked in went from 0 to 1 at /);

  await actionButton(workerPage, 'Check out', AMARA).click();
  await expectWorkerStatus(workerPage, 'Accepted', 'Checked out');
  await expect(workerPage.getByText("You've checked out. This shift is complete.")).toBeVisible();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked out');
  await expectCounts(manager, { filled: 1, checkedIn: 0, checkedOut: 1 });
  await expectTone(manager, AMARA, 'none');
  // Still on Checked in, updated live; a reload goes back to Filled.
  await expect(chartCaption(manager)).toHaveText(/^Checked in was back at 0 (at|between) /);
  await manager.reload();
  await expect(staffingTile(manager, 'Filled')).toHaveAttribute('aria-pressed', 'true');

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
