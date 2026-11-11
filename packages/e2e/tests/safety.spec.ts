import type { Page } from '@playwright/test';
import {
  actionButton,
  expect,
  expectManagerStatus,
  expectWorkerStatus,
  openManager,
  openWorker,
  serverEvents,
  serverWorker,
  test,
  timelineEntries,
  WORKERS,
} from '../lib/app';

const SOFIA = WORKERS.sofia;
const AMARA = WORKERS.amara;

/**
 * Lets the page's live connection run normally but, once `freeze()` is called, drops the
 * change messages coming from the server, and answers its catch-up reads with no new events
 * (the page also reads what it missed every few seconds). The page stays "Live" while showing
 * an out-of-date screen: the only way to make the UI offer an action the server will refuse.
 * Must be called before the page connects.
 */
async function freezableLiveUpdates(page: Page): Promise<{ freeze: () => void }> {
  let frozen = false;
  await page.routeWebSocket(/\/event\/realtime/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (frozen && typeof m === 'string' && JSON.parse(m).type === 'data') return;
      ws.send(m);
    });
  });
  await page.route(/\/api\/shifts\/[^/]+\/events/, async (route) => {
    const res = await route.fetch();
    if (!frozen) return route.fulfill({ response: res });
    const page = (await res.json()) as { events: unknown[] };
    return route.fulfill({ response: res, json: { ...page, events: [], hasMore: false } });
  });
  return { freeze: () => (frozen = true) };
}

test('an action the server refuses is rolled back with its message', async ({
  manager,
  workerPage,
  browser,
}) => {
  // A second tab for the same worker, which stops receiving changes.
  const staleCtx = await browser.newContext();
  const stale = await staleCtx.newPage();
  const live = await freezableLiveUpdates(stale);

  await openManager(manager);
  await openWorker(workerPage, SOFIA);
  await openWorker(stale, SOFIA);

  await actionButton(manager, 'Invite', SOFIA).click();
  await expectWorkerStatus(stale, 'Invited');
  live.freeze();

  // Sofia declines in her up-to-date tab; the stale tab still offers Accept.
  await actionButton(workerPage, 'Decline', SOFIA).click();
  await expectManagerStatus(manager, SOFIA, 'Declined');
  await expectWorkerStatus(stale, 'Invited');

  await actionButton(stale, 'Accept', SOFIA).click();

  // Refused with a readable message, and the stale tab ends up showing the truth.
  await expect(stale.getByRole('alert')).toContainText(
    "Sofia Rossi's status changed since you loaded it. They are now Declined.",
  );
  await expectWorkerStatus(stale, 'Declined');
  await expectManagerStatus(manager, SOFIA, 'Declined');
  expect((await serverEvents(stale.request)).map((e) => e.type)).toEqual(['invite', 'decline']);

  await staleCtx.close();
});

test('double clicks never apply an action twice or change its timestamp', async ({
  manager,
  workerPage,
  request,
}) => {
  await openManager(manager);
  await openWorker(workerPage, AMARA);

  await actionButton(manager, 'Invite', AMARA).dblclick();
  await expectWorkerStatus(workerPage, 'Invited');
  const invited = await serverWorker(request, AMARA);

  await actionButton(workerPage, 'Accept', AMARA).dblclick();
  await expectManagerStatus(manager, AMARA, 'Accepted');
  const accepted = await serverWorker(request, AMARA);

  await actionButton(workerPage, 'Check in', AMARA).dblclick();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked in');
  const checkedIn = await serverWorker(request, AMARA);

  await actionButton(workerPage, 'Check out', AMARA).dblclick();
  await expectManagerStatus(manager, AMARA, 'Accepted', 'Checked out');

  // Let any stray second request land before checking.
  await workerPage.waitForTimeout(1_000);
  const final = await serverWorker(request, AMARA);

  // One event per action, nothing extra (a stray second click must not, say, cancel).
  expect((await serverEvents(request)).map((e) => e.type)).toEqual([
    'invite',
    'accept',
    'check_in',
    'check_out',
  ]);
  expect(final.version).toBe(4);
  // Timestamps are set once and never overwritten.
  expect(final.invitedAt).toBe(invited.invitedAt);
  expect(final.respondedAt).toBe(accepted.respondedAt);
  expect(final.checkedInAt).toBe(checkedIn.checkedInAt);
  await expect(timelineEntries(manager)).toHaveCount(4);
});
