import { deriveCounts } from '@staffing/domain';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { makeSnapshot, renderApp, worker } from '../test/render';
import { WORKER_STORAGE_KEY } from './WorkerPage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const row = (name: string) => screen.getByRole('rowheader', { name }).closest('tr')!;
const counts = () => ({
  filled: Number(screen.getByTestId('count-filled').textContent),
  remaining: Number(screen.getByTestId('count-remaining').textContent),
});

describe('manager: invite', () => {
  it('shows Invite only for Uninvited and Declined workers', async () => {
    fakeApi(
      makeSnapshot([
        worker('a', 'Ana'),
        worker('b', 'Ben', { participation: 'declined' }),
        worker('c', 'Cy', { participation: 'invited' }),
        worker('d', 'Di', { participation: 'accepted' }),
        worker('e', 'Ed', { participation: 'cancelled' }),
      ]),
    );
    renderApp('/manager');
    await screen.findByRole('table');
    expect(within(row('Ana')).getByRole('button', { name: 'Invite Ana' })).toBeEnabled();
    expect(within(row('Ben')).getByRole('button', { name: 'Invite Ben' })).toBeEnabled();
    for (const n of ['Cy', 'Di', 'Ed']) expect(within(row(n)).queryByRole('button')).toBeNull();
  });

  it('invites with an Idempotency-Key and expectedVersion, then shows the new status and time', async () => {
    const api = fakeApi(makeSnapshot());
    renderApp('/manager');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite Amara Okafor' }));

    await waitFor(() => expect(within(row('Amara Okafor')).getByText('Invited')).toBeInTheDocument());
    const [post] = api.posts();
    expect(post).toMatchObject({
      url: '/api/shifts/harbourfront-gala/workers/amara/actions',
      body: { action: 'invite', expectedVersion: 0 },
    });
    expect(post!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(within(row('Amara Okafor')).getByText(/3:01\sp\.m\./)).toBeInTheDocument(); // invitedAt in Toronto time
    expect(within(row('Amara Okafor')).queryByRole('button')).toBeNull();
  });

  it('a double click while the request is in flight sends one request', async () => {
    const api = fakeApi(makeSnapshot());
    renderApp('/manager');
    const button = await screen.findByRole('button', { name: 'Invite Liam Chen' });
    const release = api.holdPosts();
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Invite…');
    release();
    await waitFor(() => expect(within(row('Liam Chen')).getByText('Invited')).toBeInTheDocument());
    expect(api.posts()).toHaveLength(1);
  });

  it("shows the server's message in a toast when an invite is refused", async () => {
    const api = fakeApi(makeSnapshot());
    // Someone else accepted Sofia's place meanwhile; the server refuses.
    api.nextPost.push(
      new Response(
        JSON.stringify({ code: 'INVALID_TRANSITION', message: "Can't invite Sofia Rossi: they are Accepted.", current: {} }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderApp('/manager');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite Sofia Rossi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't invite Sofia Rossi: they are Accepted.");
  });

  it('retries a lost request with the same Idempotency-Key', async () => {
    const api = fakeApi(makeSnapshot());
    api.nextPost.push(new TypeError('Failed to fetch'));
    renderApp('/manager');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite Amara Okafor' }));
    await waitFor(() => expect(within(row('Amara Okafor')).getByText('Invited')).toBeInTheDocument(), {
      timeout: 3000,
    });
    const [first, retry] = api.posts();
    expect(retry).toBeDefined();
    expect(retry!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('worker: accept, decline, cancel', () => {
  const pick = async (name: string) => userEvent.selectOptions(await screen.findByLabelText('Who are you?'), name);

  it('shows only the buttons the transition table allows', async () => {
    fakeApi(
      makeSnapshot([
        worker('a', 'Ana'),
        worker('b', 'Ben', { participation: 'invited' }),
        worker('c', 'Cy', { participation: 'accepted' }),
        worker('d', 'Di', { participation: 'cancelled' }),
        worker('e', 'Ed', { participation: 'declined' }),
        worker('f', 'Flo', { participation: 'accepted', attendance: 'checked_in' }),
      ]),
    );
    renderApp('/worker');
    const buttons = () => screen.queryAllByRole('button', { name: /^(Accept|Decline|Cancel) / }).map((b) => b.textContent);

    await pick('Ana');
    expect(buttons()).toEqual([]);
    expect(screen.getByText("You haven't been invited to this shift yet.")).toBeInTheDocument();
    await pick('Ben');
    expect(buttons()).toEqual(['Accept', 'Decline']);
    await pick('Cy');
    expect(buttons()).toEqual(['Cancel']);
    await pick('Di');
    expect(buttons()).toEqual(['Accept']);
    await pick('Ed');
    expect(buttons()).toEqual([]);
    await pick('Flo');
    expect(buttons()).toEqual([]); // cancel disappears once checked in
  });

  it('accept → cancel → accept again, with the status updating each time', async () => {
    const api = fakeApi(makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'invited', version: 1 })]));
    renderApp('/worker');
    await pick('Amara Okafor');

    await userEvent.click(screen.getByRole('button', { name: 'Accept Amara Okafor' }));
    await waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Amara Okafor' }));
    await waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Cancelled'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept Amara Okafor' }));
    await waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted'));

    expect(api.posts().map((p) => p.body)).toEqual([
      { action: 'accept', expectedVersion: 1 },
      { action: 'cancel', expectedVersion: 2 },
      { action: 'accept', expectedVersion: 3 },
    ]);
    // Every click is its own intent with its own key.
    expect(new Set(api.posts().map((p) => p.headers['idempotency-key'])).size).toBe(3);
  });

  it('decline moves to Declined and removes the buttons', async () => {
    fakeApi(makeSnapshot([worker('liam', 'Liam Chen', { participation: 'invited' })]));
    renderApp('/worker');
    await pick('Liam Chen');
    await userEvent.click(screen.getByRole('button', { name: 'Decline Liam Chen' }));
    await waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Declined'));
    expect(screen.queryByRole('button', { name: /Liam Chen/ })).toBeNull();
  });

  it('accepting a full shift shows "No places left"', async () => {
    fakeApi(
      makeSnapshot(
        [worker('a', 'Ana', { participation: 'accepted' }), worker('b', 'Ben', { participation: 'invited' })],
        { required: 1, acceptedCount: 1 },
      ),
    );
    renderApp('/worker');
    await pick('Ben');
    await userEvent.click(screen.getByRole('button', { name: 'Accept Ben' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No places left');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Invited');
  });

  it('a stale page gets the "changed since you loaded it" message and the fresh status', async () => {
    const start = makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'invited', version: 1 })]);
    const api = fakeApi(start);
    localStorage.setItem(WORKER_STORAGE_KEY, 'amara');
    renderApp('/worker');
    await screen.findByRole('button', { name: 'Decline Amara Okafor' });
    // Another tab accepted in the meantime.
    api.setSnapshot({
      ...start,
      shift: { ...start.shift, acceptedCount: 1 },
      workers: [{ ...start.workers[0]!, participation: 'accepted', version: 2 }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Decline Amara Okafor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed since you loaded it\. They are now Accepted/);
    await waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted'));
  });
});

describe('worker: check in and check out', () => {
  const pick = async (name: string) => userEvent.selectOptions(await screen.findByLabelText('Who are you?'), name);
  const buttons = () => screen.queryAllByRole('button', { name: /Amara Okafor$/ }).map((b) => b.textContent);

  it('Accepted → Check in (Cancel still offered) → Check out (Cancel gone) → final, with times shown', async () => {
    const api = fakeApi(makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'accepted', version: 2 })]));
    renderApp('/worker');
    await pick('Amara Okafor');
    expect(buttons()).toEqual(['Check in', 'Cancel']);

    await userEvent.click(screen.getByRole('button', { name: 'Check in Amara Okafor' }));
    await waitFor(() => expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked in'));
    expect(buttons()).toEqual(['Check out']);
    expect(screen.getByText(/3:01\sp\.m\./)).toBeInTheDocument(); // checkedInAt in Toronto time

    await userEvent.click(screen.getByRole('button', { name: 'Check out Amara Okafor' }));
    await waitFor(() => expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked out'));
    expect(buttons()).toEqual([]);
    expect(screen.getByText("You've checked out. This shift is complete.")).toBeInTheDocument();
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted');

    expect(api.posts().map((p) => p.body)).toEqual([
      { action: 'check_in', expectedVersion: 2 },
      { action: 'check_out', expectedVersion: 3 },
    ]);
  });

  it('Check in is not offered before accepting', async () => {
    fakeApi(makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'invited' })]));
    renderApp('/worker');
    await pick('Amara Okafor');
    expect(buttons()).toEqual(['Accept', 'Decline']);
  });

  it('a double click on Check in sends one request', async () => {
    const api = fakeApi(makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'accepted', version: 2 })]));
    renderApp('/worker');
    await pick('Amara Okafor');
    const release = api.holdPosts();
    await userEvent.dblClick(screen.getByRole('button', { name: 'Check in Amara Okafor' }));
    release();
    await waitFor(() => expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked in'));
    expect(api.posts()).toHaveLength(1);
  });

  it('the manager table shows check-in / check-out times and counts after the worker acts', async () => {
    const api = fakeApi(
      makeSnapshot([
        worker('amara', 'Amara Okafor', { participation: 'accepted', version: 2 }),
        worker('liam', 'Liam Chen', { participation: 'accepted', version: 2 }),
      ], { acceptedCount: 2 }),
    );
    renderApp('/worker');
    await pick('Amara Okafor');
    await userEvent.click(screen.getByRole('button', { name: 'Check in Amara Okafor' }));
    await waitFor(() => expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked in'));
    await pick('Liam Chen');
    await userEvent.click(screen.getByRole('button', { name: 'Check in Liam Chen' }));
    await waitFor(() => expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked in'));
    await userEvent.click(screen.getByRole('button', { name: 'Check out Liam Chen' }));
    await waitFor(() => expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked out'));

    await userEvent.click(screen.getByRole('link', { name: 'Manager' }));
    await screen.findByRole('table');
    await waitFor(() => expect(screen.getByTestId('count-checked-out')).toHaveTextContent('1'));
    expect(screen.getByTestId('count-checked-in')).toHaveTextContent('1');
    expect(screen.getByTestId('count-filled')).toHaveTextContent('2');
    expect(screen.getByTestId('count-remaining')).toHaveTextContent('1');
    // Clock ticks a minute per POST from 20:00Z: 3:01, 3:02, 3:03 p.m. Toronto.
    expect(row('Amara Okafor')).toHaveTextContent(/3:01\sp\.m\./);
    expect(row('Liam Chen')).toHaveTextContent(/3:02\sp\.m\..*3:03\sp\.m\./);
    expect(api.snapshot.shift.acceptedCount).toBe(2);
  });
});

describe('counts stay consistent with the list', () => {
  it('filled / remaining follow every action', async () => {
    const api = fakeApi(makeSnapshot(undefined, { required: 2 }));
    renderApp('/manager');
    for (const name of ['Amara Okafor', 'Liam Chen']) {
      await userEvent.click(await screen.findByRole('button', { name: `Invite ${name}` }));
      await waitFor(() => expect(within(row(name)).getByText('Invited')).toBeInTheDocument());
    }
    // Workers respond in another tab.
    const s = api.snapshot;
    api.setSnapshot({
      ...s,
      shift: { ...s.shift, acceptedCount: 2 },
      workers: s.workers.map((w) => (w.participation === 'invited' ? { ...w, participation: 'accepted' } : w)),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Invite Sofia Rossi' }));
    await waitFor(() => expect(counts()).toEqual({ filled: 2, remaining: 0 }));
    const derived = deriveCounts(api.snapshot.workers, 2);
    expect(counts()).toEqual({ filled: derived.filled, remaining: derived.remaining });
  });
});
