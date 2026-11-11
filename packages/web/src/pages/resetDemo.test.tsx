import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESET_WARNING } from '../components/ResetDemo';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { findWorkerCard, jsonResponse, makeSnapshot, renderApp, trackerOf } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

const resetButton = () => screen.getByRole('button', { name: 'Reset demo' });
const dialog = () => screen.getByRole('dialog', { name: 'Reset demo?' });
const resets = (api: ReturnType<typeof fakeApi>) => api.posts().filter((p) => p.url === '/api/demo/reset');

async function manager() {
  const api = fakeApi(makeSnapshot());
  const t = fakeTransport();
  renderApp('/manager', { transport: t.transport });
  await findWorkerCard('Amara Okafor');
  await act(async () => t.last.subscribed());
  return { api, t };
}

describe('Reset demo on the manager dashboard', () => {
  it('sits with the demo controls on the manager page only', async () => {
    await manager();
    expect(resetButton()).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Worker' }));
    await screen.findByRole('heading', { name: 'My shift' });
    expect(screen.queryByRole('button', { name: 'Reset demo' })).toBeNull();
  });

  it('opens a named modal with the exact warning, Cancel focused by default', async () => {
    await manager();
    await userEvent.click(resetButton());
    const d = dialog();
    expect(d).toHaveTextContent(RESET_WARNING);
    expect(d).toHaveAccessibleDescription(RESET_WARNING);
    expect(within(d).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(d).getByRole('button', { name: 'Reset demo' })).toBeInTheDocument();
  });

  it('Cancel, Escape and a backdrop click close it without calling the API, returning focus', async () => {
    const { api } = await manager();
    await userEvent.click(resetButton());
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(resetButton()).toHaveFocus();

    await userEvent.click(resetButton());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(resetButton()).toHaveFocus();

    await userEvent.click(resetButton());
    fireEvent.click(dialog()); // the backdrop is the <dialog> itself
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(resets(api)).toHaveLength(0);
  });

  it('confirms once even when double-clicked, shows "Resetting…", then closes with a toast and the seed', async () => {
    const { api, t } = await manager();
    await act(async () => t.last.send(api.act('amara', 'invite')));
    await vi.waitFor(() => expect(trackerOf('Amara Okafor')).toHaveTextContent('Invited'));
    await userEvent.click(screen.getByRole('switch', { name: 'Simulate outage' }));
    expect(screen.getByRole('switch', { name: 'Simulate outage' })).toBeChecked();

    const release = api.holdPosts();
    await userEvent.click(resetButton());
    const confirm = within(dialog()).getByRole('button', { name: 'Reset demo' });
    await userEvent.dblClick(confirm);
    expect(within(dialog()).getByRole('button', { name: 'Resetting…' })).toBeDisabled();

    release();
    expect(await screen.findByText('Demo reset')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(resets(api)).toHaveLength(1);
    expect(screen.getByRole('switch', { name: 'Simulate outage' })).not.toBeChecked();

    // The page resets through the epoch: reconnect, catch-up sees the new epoch.
    await act(async () => t.last.subscribed());
    await vi.waitFor(() => expect(trackerOf('Amara Okafor')).toHaveTextContent('Not invited'));
  });

  it("shows the server's error inside the modal and stays open", async () => {
    const { api } = await manager();
    api.nextPost.push(
      jsonResponse(500, { code: 'INTERNAL', message: 'Something went wrong on the server.' }),
    );
    await userEvent.click(resetButton());
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Reset demo' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Something went wrong on the server.',
    );
    expect(within(dialog()).getByRole('button', { name: 'Reset demo' })).toBeEnabled();
  });
});
