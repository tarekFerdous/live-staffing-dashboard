import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, makeSnapshot, renderApp, stubFetch, worker } from '../test/render';
import { WORKER_STORAGE_KEY } from './WorkerPage';

const snapshot = makeSnapshot([
  worker('amara', 'Amara Okafor', { participation: 'invited' }),
  worker('liam', 'Liam Chen', { participation: 'accepted', attendance: 'checked_in', checkedInAt: '2026-12-12T22:10:00.000Z' }),
  worker('sofia', 'Sofia Rossi'),
]);

beforeEach(() => {
  localStorage.clear();
  stubFetch(jsonResponse(200, snapshot));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('worker page', () => {
  it("shows the selected worker's statuses from the snapshot", async () => {
    renderApp('/worker');
    expect(await screen.findByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' })).toBeInTheDocument();
    expect(screen.getByText('Choose your name to see your status.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Who are you?'), 'Liam Chen');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted');
    expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked in');
    expect(screen.getByText(/5:10\sp\.m\./)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Who are you?'), 'Amara Okafor');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Invited');
    expect(screen.getByTestId('my-attendance')).toHaveTextContent('Not started');
  });

  it('remembers the selection across a refresh', async () => {
    const first = renderApp('/worker');
    await userEvent.selectOptions(await screen.findByLabelText('Who are you?'), 'Amara Okafor');
    expect(localStorage.getItem(WORKER_STORAGE_KEY)).toBe('amara');
    first.unmount();

    renderApp('/worker');
    expect(await screen.findByTestId('my-participation')).toHaveTextContent('Invited');
    expect(screen.getByLabelText('Who are you?')).toHaveValue('amara');
  });

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderApp('/worker');
    await userEvent.selectOptions(await screen.findByLabelText('Who are you?'), 'Sofia Rossi');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Uninvited');
  });

  it('ignores a remembered worker that no longer exists', async () => {
    localStorage.setItem(WORKER_STORAGE_KEY, 'ghost');
    renderApp('/worker');
    expect(await screen.findByText('Choose your name to see your status.')).toBeInTheDocument();
  });

  it('links between the manager and worker pages', async () => {
    renderApp('/worker');
    await userEvent.click(await screen.findByRole('link', { name: 'Manager' }));
    expect(await screen.findByRole('heading', { name: 'Manager dashboard' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Worker' }));
    expect(await screen.findByRole('heading', { name: 'My shift' })).toBeInTheDocument();
  });
});
