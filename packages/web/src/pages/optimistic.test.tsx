import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { jsonResponse, makeSnapshot, renderApp, worker } from '../test/render';
import { WORKER_STORAGE_KEY } from './WorkerPage';

beforeEach(() => localStorage.setItem(WORKER_STORAGE_KEY, 'amara'));
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const invitedAmara = () =>
  makeSnapshot([
    worker('amara', 'Amara Okafor', {
      participation: 'invited',
      invitedAt: '2026-12-12T19:00:00.000Z',
      version: 1,
    }),
    worker('liam', 'Liam Chen'),
    worker('sofia', 'Sofia Rossi'),
  ]);

const myParticipation = () => screen.getByTestId('my-participation').textContent;

async function liveWorker() {
  const api = fakeApi(invitedAmara());
  const t = fakeTransport();
  renderApp('/worker', { transport: t.transport });
  await screen.findByRole('button', { name: 'Accept Amara Okafor' });
  await act(async () => t.last.subscribed());
  return { api, t };
}

/** Records every participation the worker's page shows, to catch a flicker between renders. */
function watchParticipation() {
  const seen: string[] = [];
  const observer = new MutationObserver(() => {
    const text = screen.queryByTestId('my-participation')?.textContent ?? '';
    if (seen.at(-1) !== text) seen.push(text);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return { seen, stop: () => observer.disconnect() };
}

describe('optimistic worker actions', () => {
  it('shows the new status at once, before the server answers', async () => {
    const { api } = await liveWorker();
    const release = api.holdPosts();
    await userEvent.click(screen.getByRole('button', { name: 'Accept Amara Okafor' }));
    expect(myParticipation()).toBe('Accepted');
    expect(api.posts()).toHaveLength(1);
    release();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check in Amara Okafor' })).toBeEnabled(),
    );
    expect(myParticipation()).toBe('Accepted');
  });

  it('rolls back to the previous status and shows the server message when refused (409)', async () => {
    const { api } = await liveWorker();
    api.nextPost.push(
      jsonResponse(409, {
        code: 'SHIFT_FULL',
        message: 'No places left',
        current: api.snapshot.workers[0],
      }),
    );
    const release = api.holdPosts();
    await userEvent.click(screen.getByRole('button', { name: 'Accept Amara Okafor' }));
    expect(myParticipation()).toBe('Accepted');

    release();
    expect(await screen.findByRole('alert')).toHaveTextContent('No places left');
    expect(myParticipation()).toBe('Invited');
    expect(screen.getByRole('button', { name: 'Accept Amara Okafor' })).toBeInTheDocument();
  });

  it('does not flicker when other live changes and the same seq arrive around the response', async () => {
    const { api, t } = await liveWorker();
    const release = api.holdPosts();
    await userEvent.click(screen.getByRole('button', { name: 'Accept Amara Okafor' }));
    expect(myParticipation()).toBe('Accepted');
    // From here on, any other value shown, even for one render, is a flicker.
    const watch = watchParticipation();

    // Someone else's change arrives while the request is in flight.
    await act(async () => t.last.send(api.act('liam', 'invite')));
    expect(myParticipation()).toBe('Accepted');

    release();
    await vi.waitFor(() => expect(api.events.some((e) => e.workerId === 'amara')).toBe(true));
    const mine = api.events.find((e) => e.workerId === 'amara' && e.type === 'accept')!;
    await act(async () => t.last.send(mine)); // the push for our own seq: a duplicate
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Check in Amara Okafor' })).toBeEnabled(),
    );
    watch.stop();

    expect(watch.seen.filter(Boolean)).toEqual(['Accepted']);
  });
});

describe('manager actions are not optimistic', () => {
  it('keeps the committed status until the server answers', async () => {
    const api = fakeApi(makeSnapshot());
    renderApp('/manager');
    const button = await screen.findByRole('button', { name: 'Invite Amara Okafor' });
    const release = api.holdPosts();
    await userEvent.click(button);
    const row = screen.getByRole('rowheader', { name: 'Amara Okafor' }).closest('tr')!;
    expect(within(row).getByText('Uninvited')).toBeInTheDocument();
    expect(within(row).queryByText('Invited')).toBeNull();
    release();
    expect(await within(row).findByText('Invited')).toBeInTheDocument();
  });
});
