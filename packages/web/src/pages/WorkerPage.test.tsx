import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detail,
  jsonResponse,
  makeSnapshot,
  pickWorker,
  renderApp,
  stubFetch,
  worker,
  workerPicker,
} from '../test/render';
import { WORKER_STORAGE_KEY } from './WorkerPage';

const snapshot = makeSnapshot([
  worker('amara', 'Amara Okafor', { participation: 'invited' }),
  worker('liam', 'Liam Chen', {
    participation: 'accepted',
    attendance: 'checked_in',
    checkedInAt: '2026-12-12T22:10:00.000Z',
  }),
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
    expect(
      await screen.findByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Choose your name to see your status.')).toBeInTheDocument();

    await pickWorker('Liam Chen');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Accepted');
    expect(screen.getByTestId('my-attendance')).toHaveTextContent('Checked in');
    expect(detail(document.body, 'Checked in')).toHaveTextContent(/5:10\sp\.m\./);

    await pickWorker('Amara Okafor');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Invited');
    expect(screen.getByTestId('my-attendance')).toHaveTextContent('Not started');
  });

  it('remembers the selection across a refresh', async () => {
    const first = renderApp('/worker');
    await pickWorker('Amara Okafor');
    expect(localStorage.getItem(WORKER_STORAGE_KEY)).toBe('amara');
    first.unmount();

    renderApp('/worker');
    expect(await screen.findByTestId('my-participation')).toHaveTextContent('Invited');
    expect(await workerPicker()).toHaveTextContent('Amara Okafor');
  });

  it('still works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    renderApp('/worker');
    await pickWorker('Sofia Rossi');
    expect(screen.getByTestId('my-participation')).toHaveTextContent('Uninvited');
  });

  it("shows the chosen worker's name and details, and switches with the choice", async () => {
    stubFetch(
      jsonResponse(
        200,
        makeSnapshot([
          worker('amara', 'Amara Okafor'),
          worker('liam', 'Liam Chen', {
            phone: '+1 647-555-0187',
            email: 'liam.chen@example.com',
            address: '412 Spadina Ave, Toronto',
          }),
        ]),
      ),
    );
    renderApp('/worker');
    await workerPicker();
    expect(screen.queryByTestId('my-profile')).toBeNull();

    await pickWorker('Amara Okafor');
    const profile = screen.getByTestId('my-profile');
    expect(within(profile).getByRole('heading', { name: 'Amara Okafor' })).toBeInTheDocument();
    expect(detail(profile, 'Role')).toHaveTextContent('Worker');
    expect(within(profile).getByRole('link', { name: '+1 416-555-0142' })).toHaveAttribute(
      'href',
      'tel:+14165550142',
    );
    expect(within(profile).getByRole('link', { name: 'amara.okafor@example.com' })).toHaveAttribute(
      'href',
      'mailto:amara.okafor@example.com',
    );
    expect(detail(profile, 'Address')).toHaveTextContent('88 Bathurst St, Toronto, ON M5V 2P5');

    await pickWorker('Liam Chen');
    const liam = screen.getByTestId('my-profile');
    expect(within(liam).getByRole('heading', { name: 'Liam Chen' })).toBeInTheDocument();
    expect(detail(liam, 'Phone')).toHaveTextContent('+1 647-555-0187');
    expect(detail(liam, 'Email')).toHaveTextContent('liam.chen@example.com');
    expect(detail(liam, 'Address')).toHaveTextContent('412 Spadina Ave, Toronto');
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
