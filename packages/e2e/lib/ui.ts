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

/** A manager worker card's status tint: none (default), good (green), bad (red), warn (yellow). */
export async function expectTone(
  page: Page,
  name: WorkerName,
  tone: 'none' | 'good' | 'bad' | 'warn',
): Promise<void> {
  await expect(managerWorker(page, name)).toHaveAttribute('data-tone', tone);
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

export type StaffingTile = 'Filled' | 'Remaining' | 'Checked in' | 'Checked out';

/** One of the Staffing card's selectable number tiles. */
export function staffingTile(page: Page, name: StaffingTile): Locator {
  return page
    .getByRole('group', { name: 'Shift summary' })
    .getByRole('button', { name: new RegExp(`^${name}\\b`) });
}

/** The Staffing chart's caption (its text alternative), e.g. "Checked in went from 0 to 1 at 3:05 p.m." */
export function chartCaption(page: Page): Locator {
  return page.getByRole('region', { name: 'Staffing', exact: true }).getByTestId('chart-text');
}

/** Timeline entries, newest first. */
export function timelineEntries(page: Page): Locator {
  return page.getByRole('list', { name: 'Activity, newest first' }).getByRole('listitem');
}

// ---------- worker ----------

export async function openWorker(page: Page, name: WorkerName): Promise<void> {
  await page.goto('/worker');
  await expect(page.getByRole('heading', { name: 'My shift' })).toBeVisible();
  await pickWorker(page, name);
  await waitForLive(page);
}

/** The Worker page's themed "Who are you?" picker (a select-only combobox). */
export function workerPicker(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Who are you?' });
}

/** Chooses a worker in the picker: open it, click the name. */
export async function pickWorker(page: Page, name: WorkerName): Promise<void> {
  await workerPicker(page).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(workerPicker(page)).toHaveText(name);
}

/** The seeded (made-up) profile details shown under the picker. */
export const PROFILES: Record<WorkerName, { role: string; phone: string; email: string; address: string }> = {
  'Amara Okafor': {
    role: 'Worker',
    phone: '+1 416-555-0142',
    email: 'amara.okafor@example.com',
    address: '88 Bathurst St, Toronto, ON M5V 2P5',
  },
  'Liam Chen': {
    role: 'Worker',
    phone: '+1 647-555-0187',
    email: 'liam.chen@example.com',
    address: '412 Spadina Ave, Toronto, ON M5T 2G7',
  },
  'Sofia Rossi': {
    role: 'Worker',
    phone: '+1 416-555-0119',
    email: 'sofia.rossi@example.com',
    address: '1020 College St, Toronto, ON M6H 1A6',
  },
};

/** The chosen worker's large name and Role / Phone / Email / Address on the Worker page. */
export async function expectWorkerProfile(page: Page, name: WorkerName): Promise<void> {
  const profile = page.getByTestId('my-profile');
  await expect(profile.getByRole('heading', { name, exact: true })).toBeVisible();
  const p = PROFILES[name];
  for (const [label, value] of [
    ['Role', p.role],
    ['Phone', p.phone],
    ['Email', p.email],
    ['Address', p.address],
  ] as const) {
    await expect(cardDetail(profile, label)).toHaveText(value);
  }
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
