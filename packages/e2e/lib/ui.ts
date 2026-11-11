/**
 * Everything the tests and measurement scripts know about the UI lives here, so a redesign
 * changes one file. Lookups use roles, labels and visible text only.
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { SHIFT_ID } from './env';

export const WORKERS = { amara: 'Amara Okafor', liam: 'Liam Chen', sofia: 'Sofia Rossi' } as const;
export type WorkerName = (typeof WORKERS)[keyof typeof WORKERS];

export type Participation = 'Uninvited' | 'Invited' | 'Accepted' | 'Declined' | 'Cancelled';
export type Attendance = 'Not started' | 'Checked in' | 'Checked out';
export type ActionLabel = 'Invite' | 'Accept' | 'Decline' | 'Cancel' | 'Check in' | 'Check out';

// ---------- shared ----------

/** The connection pill reads Live once the page is subscribed to its shift's channel. */
export async function waitForLive(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Connection: Live' })).toBeVisible({ timeout: 20_000 });
}

export function outageSwitch(page: Page): Locator {
  return page.getByRole('switch', { name: 'Simulate outage' });
}

export function actionButton(page: Page, action: ActionLabel, name: WorkerName): Locator {
  return page.getByRole('button', { name: `${action} ${name}`, exact: true });
}

// ---------- manager ----------

export async function openManager(page: Page): Promise<void> {
  await page.goto('/manager');
  await expect(page.getByRole('heading', { name: 'Manager dashboard' })).toBeVisible();
  await waitForLive(page);
}

/** One worker's card on the manager page (a region named by the worker's name). */
export function managerWorker(page: Page, name: WorkerName): Locator {
  return page.getByRole('region', { name, exact: true });
}

/** The value next to a label in a card's details, e.g. `Participation` → "Accepted". */
export function cardDetail(card: Locator, label: string): Locator {
  return card.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
}

/** The card's tracker text: "Step 2 of 4: Accepted", "Not invited", … */
export function tracker(card: Locator): Locator {
  return card.getByTestId('tracker');
}

export async function expectManagerStatus(
  page: Page,
  name: WorkerName,
  participation: Participation,
  attendance: Attendance = 'Not started',
): Promise<void> {
  const card = managerWorker(page, name);
  await expect(cardDetail(card, 'Participation')).toHaveText(participation);
  await expect(cardDetail(card, 'Attendance')).toHaveText(attendance);
}

export function filledCount(page: Page): Locator {
  return page.getByTestId('count-filled');
}

export async function expectCounts(
  page: Page,
  counts: { filled: number; remaining?: number; checkedIn?: number; checkedOut?: number },
): Promise<void> {
  await expect(filledCount(page)).toHaveText(String(counts.filled));
  await expect(page.getByTestId('count-remaining')).toHaveText(String(counts.remaining ?? 3 - counts.filled));
  await expect(page.getByTestId('count-checked-in')).toHaveText(String(counts.checkedIn ?? 0));
  await expect(page.getByTestId('count-checked-out')).toHaveText(String(counts.checkedOut ?? 0));
}

/** Timeline entries, newest first. */
export function timelineEntries(page: Page): Locator {
  return page.getByRole('list', { name: 'Activity, newest first' }).getByRole('listitem');
}

// ---------- worker ----------

export async function openWorker(page: Page, name: WorkerName): Promise<void> {
  await page.goto('/worker');
  await expect(page.getByRole('heading', { name: 'My shift' })).toBeVisible();
  await page.getByLabel('Who are you?').selectOption({ label: name });
  await waitForLive(page);
}

export async function expectWorkerStatus(
  page: Page,
  participation: Participation,
  attendance: Attendance = 'Not started',
): Promise<void> {
  await expect(page.getByTestId('my-participation')).toHaveText(participation);
  await expect(page.getByTestId('my-attendance')).toHaveText(attendance);
}

// ---------- server state (for checks the UI can't make precise, like exact timestamps) ----------

type ServerWorker = {
  id: string;
  name: string;
  participation: string;
  attendance: string;
  invitedAt: string | null;
  respondedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  version: number;
};

export async function serverSnapshot(request: APIRequestContext) {
  const res = await request.get(`/api/shifts/${SHIFT_ID}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as { shift: { acceptedCount: number }; workers: ServerWorker[] };
}

export async function serverWorker(request: APIRequestContext, name: WorkerName): Promise<ServerWorker> {
  const w = (await serverSnapshot(request)).workers.find((x) => x.name === name);
  if (!w) throw new Error(`No worker named ${name}`);
  return w;
}

export async function serverEvents(request: APIRequestContext) {
  const res = await request.get(`/api/shifts/${SHIFT_ID}/events?after=0`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { events: { seq: number; type: string; workerId: string }[] }).events;
}

export { expect };
