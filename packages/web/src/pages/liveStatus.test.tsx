import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { makeSnapshot, renderApp, findWorkerCard, trackerOf } from '../test/render';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pill = () => screen.getByTestId('connection-pill');
const inviteButton = (name: string) => screen.getByRole('button', { name: `Invite ${name}` });

async function liveManager() {
  const api = fakeApi(makeSnapshot());
  const t = fakeTransport();
  renderApp('/manager', { transport: t.transport });
  await findWorkerCard('Amara Okafor');
  expect(pill()).toHaveTextContent('Connecting…');
  await act(async () => t.last.subscribed());
  expect(pill()).toHaveTextContent('Live');
  return { api, t };
}

describe('connection pill, outage switch and latency badge', () => {
  it('switching the outage on shows Reconnecting and disables actions with a reason', async () => {
    const { t } = await liveManager();
    expect(inviteButton('Amara Okafor')).toBeEnabled();

    await userEvent.click(screen.getByRole('switch', { name: 'Simulate outage' }));

    expect(screen.getByRole('switch', { name: 'Simulate outage' })).toHaveAttribute('aria-checked', 'true');
    expect(t.last.closed).toBe(true);
    expect(pill()).toHaveTextContent('Reconnecting…');
    const button = inviteButton('Amara Okafor');
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Actions are turned off/);
    expect(t.connections).toHaveLength(1); // no reconnect while the outage is on
  });

  it('switching it off reconnects and applies changes made meanwhile without a refresh', async () => {
    const { api, t } = await liveManager();
    await userEvent.click(screen.getByRole('switch', { name: 'Simulate outage' }));

    // Another session changes the shift while this page is cut off.
    api.act('liam', 'invite');
    api.act('liam', 'accept');

    await userEvent.click(screen.getByRole('switch', { name: 'Simulate outage' }));
    expect(t.connections).toHaveLength(2);
    await act(async () => t.last.subscribed());

    expect(pill()).toHaveTextContent('Live');
    await vi.waitFor(() => expect(trackerOf('Liam Chen')).toHaveTextContent('Accepted'));
    expect(screen.getByTestId('count-filled')).toHaveTextContent('1');
    expect(inviteButton('Amara Okafor')).toBeEnabled();
    expect(screen.queryByText(/Actions are turned off/)).not.toBeInTheDocument();
  });

  it('shows Reconnecting when the connection drops, then Live again by itself', async () => {
    const { t } = await liveManager();
    await act(async () => t.last.drop('keep-alive timeout'));
    expect(pill()).toHaveTextContent('Reconnecting…');
    await vi.waitFor(() => expect(t.connections).toHaveLength(2)); // after a ~250 ms backoff
    await act(async () => t.last.subscribed());
    expect(pill()).toHaveTextContent('Live');
  });

  it('updates the latency badge on each live event and labels it approximate', async () => {
    const { api, t } = await liveManager();
    expect(screen.queryByTestId('latency-badge')).not.toBeInTheDocument();

    vi.useFakeTimers({ toFake: ['Date'] });
    const e1 = api.act('amara', 'invite');
    vi.setSystemTime(Date.parse(e1.at) + 180);
    await act(async () => t.last.send(e1));
    const badge = await screen.findByTestId('latency-badge');
    expect(badge).toHaveTextContent('≈ 180 ms');
    expect(badge).toHaveTextContent(/approx/);
    expect(badge).toHaveAttribute('title', expect.stringMatching(/Approximate/));

    const e2 = api.act('liam', 'invite');
    vi.setSystemTime(Date.parse(e2.at) + 95);
    await act(async () => t.last.send(e2));
    await vi.waitFor(() => expect(screen.getByTestId('latency-badge')).toHaveTextContent('≈ 95 ms'));
  });

  it('shows Offline when the browser goes offline, and reconnects when it is back', async () => {
    const { t } = await liveManager();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event('offline')));

    expect(pill()).toHaveTextContent('Offline');
    expect(t.last.closed).toBe(true);
    expect(inviteButton('Amara Okafor')).toBeDisabled();
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();

    onLine.mockReturnValue(true);
    await act(async () => window.dispatchEvent(new Event('online')));
    expect(t.connections).toHaveLength(2);
    await act(async () => t.last.subscribed());
    expect(pill()).toHaveTextContent('Live');
    expect(inviteButton('Amara Okafor')).toBeEnabled();
  });

  it('without a live channel shows "Live updates off", hides the switch and keeps actions on', async () => {
    fakeApi(makeSnapshot());
    renderApp('/manager');
    await findWorkerCard('Amara Okafor');
    expect(pill()).toHaveTextContent('Live updates off');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(inviteButton('Amara Okafor')).toBeEnabled();
  });
});
