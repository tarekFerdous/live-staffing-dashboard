import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_STORAGE_KEY } from './WorkerPage';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { makeSnapshot, renderApp, findWorkerCard, trackerOf } from '../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const snapshotGets = (api: ReturnType<typeof fakeApi>) =>
  api.calls.filter((c) => c.method === 'GET' && !c.url.includes('/events')).length;

async function liveManager() {
  const api = fakeApi(makeSnapshot());
  const t = fakeTransport();
  renderApp('/manager', { transport: t.transport });
  await findWorkerCard('Amara Okafor');
  await act(async () => t.last.subscribed());
  return { api, t };
}

describe('live updates', () => {
  it('shows an acceptance on the manager page without a refresh, counts and list together', async () => {
    const { api, t } = await liveManager();
    expect(t.last.channel).toBe('/shifts/harbourfront-gala');
    const gets = snapshotGets(api);

    // Another session (the manager elsewhere, then the worker) changes the shift.
    const invite = api.act('amara', 'invite');
    const accept = api.act('amara', 'accept');
    await act(async () => {
      t.last.send(invite);
      t.last.send(accept);
    });

    await vi.waitFor(() => expect(trackerOf('Amara Okafor')).toHaveTextContent('Accepted'));
    expect(screen.getByTestId('count-filled')).toHaveTextContent('1');
    expect(screen.getByTestId('count-remaining')).toHaveTextContent('2');
    expect(snapshotGets(api)).toBe(gets); // pushed, not refetched
  });

  it('shows check-in and check-out as they happen', async () => {
    const { api, t } = await liveManager();
    for (const a of ['invite', 'accept', 'check_in'] as const) {
      const e = api.act('liam', a);
      await act(async () => t.last.send(e));
    }
    await vi.waitFor(() => expect(screen.getByTestId('count-checked-in')).toHaveTextContent('1'));
    const out = api.act('liam', 'check_out');
    await act(async () => t.last.send(out));
    await vi.waitFor(() => expect(screen.getByTestId('count-checked-in')).toHaveTextContent('0'));
    expect(screen.getByTestId('count-checked-out')).toHaveTextContent('1');
    expect(trackerOf('Liam Chen')).toHaveTextContent('Checked out');
  });

  it('fills a missed event from the catch-up API', async () => {
    const { api, t } = await liveManager();
    api.act('amara', 'invite'); // its push is lost
    const e2 = api.act('liam', 'invite');
    await act(async () => t.last.send(e2));
    await vi.waitFor(() => expect(trackerOf('Amara Okafor')).toHaveTextContent('Invited'));
    expect(trackerOf('Liam Chen')).toHaveTextContent('Invited');
    expect(api.calls.some((c) => c.url.endsWith('/events?after=0'))).toBe(true);
  });

  it("updates the worker's page when the manager invites them", async () => {
    localStorage.setItem(WORKER_STORAGE_KEY, 'sofia');
    const api = fakeApi(makeSnapshot());
    const t = fakeTransport();
    renderApp('/worker', { transport: t.transport });
    expect(await screen.findByText(/haven't been invited/)).toBeInTheDocument();
    await act(async () => t.last.subscribed());

    const invite = api.act('sofia', 'invite');
    await act(async () => t.last.send(invite));
    expect(await screen.findByRole('button', { name: 'Accept Sofia Rossi' })).toBeInTheDocument();
  });

  it("applies the page's own action from the response, without refetching the snapshot", async () => {
    const { api } = await liveManager();
    const gets = snapshotGets(api);
    await userEvent.click(screen.getByRole('button', { name: 'Invite Amara Okafor' }));
    await vi.waitFor(() => expect(trackerOf('Amara Okafor')).toHaveTextContent('Invited'));
    expect(snapshotGets(api)).toBe(gets);
  });
});
