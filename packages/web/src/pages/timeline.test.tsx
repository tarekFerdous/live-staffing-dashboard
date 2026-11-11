import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { makeSnapshot, renderApp, findWorkerCard } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

const entries = () =>
  within(screen.getByTestId('timeline'))
    .getAllByRole('listitem')
    .map((li) => li.textContent?.replace(/^.*?\s[ap]\.m\./, ''));

async function liveManager(setupHistory?: (api: ReturnType<typeof fakeApi>) => void) {
  const api = fakeApi(makeSnapshot());
  setupHistory?.(api);
  const t = fakeTransport();
  renderApp('/manager', { transport: t.transport });
  await findWorkerCard('Amara Okafor');
  await act(async () => t.last.subscribed());
  return { api, t };
}

describe('activity timeline on the manager dashboard', () => {
  it('loads the existing history, newest first', async () => {
    await liveManager((api) => {
      api.act('amara', 'invite');
      api.act('amara', 'accept');
    });
    await screen.findByTestId('timeline');
    expect(entries()).toEqual(['Amara Okafor acceptedWorker', 'Manager invited Amara OkaforManager']);
  });

  it('puts new actions at the top without a refresh', async () => {
    const { api, t } = await liveManager();
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
    const gets = api.calls.length;

    await act(async () => t.last.send(api.act('liam', 'invite')));
    expect(await screen.findByText('Manager invited Liam Chen')).toBeInTheDocument();
    await act(async () => t.last.send(api.act('liam', 'accept')));
    await vi.waitFor(() => expect(entries()[0]).toBe('Liam Chen acceptedWorker'));
    expect(entries()).toHaveLength(2);
    expect(api.calls.length).toBe(gets); // pushed events are used as they are, no extra reads
  });

  it("adds the page's own action, read from the log", async () => {
    await liveManager();
    await screen.findByText('No activity yet.');
    await userEvent.click(screen.getByRole('button', { name: 'Invite Sofia Rossi' }));
    expect(await screen.findByText('Manager invited Sofia Rossi')).toBeInTheDocument();
  });

  it('fills the entries missed during an outage, in order', async () => {
    const { api, t } = await liveManager();
    await screen.findByText('No activity yet.');
    await userEvent.click(screen.getByRole('switch', { name: /simulate outage/i }));

    // Three changes happen while this page is cut off.
    api.act('amara', 'invite');
    api.act('liam', 'invite');
    api.act('amara', 'accept');

    await userEvent.click(screen.getByRole('switch', { name: /simulate outage/i }));
    await act(async () => t.last.subscribed());
    await vi.waitFor(() => expect(entries()).toHaveLength(3));
    expect(entries()).toEqual([
      'Amara Okafor acceptedWorker',
      'Manager invited Liam ChenManager',
      'Manager invited Amara OkaforManager',
    ]);
  });
});
