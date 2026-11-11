import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { findWorkerCard, makeSnapshot, renderApp, trackerOf } from '../test/render';
import { WORKER_STORAGE_KEY } from './WorkerPage';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function livePage(path: string) {
  const api = fakeApi(makeSnapshot());
  const t = fakeTransport();
  renderApp(path, { transport: t.transport });
  return { api, t };
}

describe('pages snap back after a reset, without a refresh', () => {
  it('manager: counts, worker cards and the timeline return to the seed; new events start again', async () => {
    const { api, t } = await livePage('/manager');
    await findWorkerCard('Amara Okafor');
    await act(async () => t.last.subscribed());
    for (const [w, a] of [
      ['amara', 'invite'],
      ['amara', 'accept'],
      ['liam', 'invite'],
    ] as const) {
      await act(async () => t.last.send(api.act(w, a)));
    }
    await vi.waitFor(() => expect(screen.getByTestId('count-filled')).toHaveTextContent('1'));
    await vi.waitFor(() =>
      expect(within(screen.getByTestId('timeline')).getAllByRole('listitem')).toHaveLength(3),
    );

    await act(async () => t.last.send(api.reset()));

    await vi.waitFor(() => expect(screen.getByTestId('count-filled')).toHaveTextContent('0'));
    expect(trackerOf('Amara Okafor')).toHaveTextContent('Not invited');
    expect(trackerOf('Liam Chen')).toHaveTextContent('Not invited');
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();

    // After the reset, changes appear live again from seq 1.
    await act(async () => t.last.send(api.act('sofia', 'invite')));
    expect(await screen.findByText('Manager invited Sofia Rossi')).toBeInTheDocument();
    expect(within(screen.getByTestId('timeline')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('worker: status and buttons go back to Uninvited / Not started', async () => {
    localStorage.setItem(WORKER_STORAGE_KEY, 'amara');
    const { api, t } = await livePage('/worker');
    await screen.findByTestId('my-participation');
    await act(async () => t.last.subscribed());
    await act(async () => t.last.send(api.act('amara', 'invite')));
    await act(async () => t.last.send(api.act('amara', 'accept')));
    await vi.waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted'));

    await act(async () => t.last.send(api.reset()));
    await vi.waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Uninvited'));
    expect(screen.getByTestId('my-attendance')).toHaveTextContent('Not started');
    expect(screen.getByText("You haven't been invited to this shift yet.")).toBeInTheDocument();
  });

  it('worker: an optimistic action in flight during a reset is dropped', async () => {
    localStorage.setItem(WORKER_STORAGE_KEY, 'amara');
    const { api, t } = await livePage('/worker');
    await screen.findByTestId('my-participation');
    await act(async () => t.last.subscribed());
    await act(async () => t.last.send(api.act('amara', 'invite')));
    await vi.waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Invited'));

    const release = api.holdPosts();
    await userEvent.click(screen.getByRole('button', { name: 'Accept Amara Okafor' }));
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted'); // optimistic

    // The reset lands while the accept is still in flight.
    await act(async () => t.last.send(api.reset()));
    await vi.waitFor(() => expect(screen.getByTestId('my-participation')).toHaveTextContent('Uninvited'));

    // Its answer (the server refuses: Amara is no longer invited) never brings the old row back.
    release();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Uninvited');
    expect(screen.queryByRole('alert')).toBeNull(); // no error toast for a dropped action
  });
});
