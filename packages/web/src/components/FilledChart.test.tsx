import type { ShiftEventMessage } from '@staffing/domain';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { findWorkerCard, makeSnapshot, renderApp, worker } from '../test/render';
import { FilledChart } from './FilledChart';

afterEach(() => vi.unstubAllGlobals());

const TZ = 'America/Toronto';
const ev = (seq: number, type: ShiftEventMessage['type'], hhmm: string): ShiftEventMessage => ({
  seq,
  type,
  workerId: `w${seq}`,
  row: worker(`w${seq}`, `W${seq}`),
  at: `2026-12-12T${hhmm}:00.000Z`, // UTC; Toronto is UTC−5
});

const chartText = () => screen.getByTestId('filled-chart-text');

describe('FilledChart', () => {
  it('has a text alternative a screen reader can read', () => {
    render(
      <FilledChart
        events={[ev(1, 'invite', '20:00'), ev(2, 'accept', '20:01'), ev(3, 'accept', '20:05')]}
        filled={2}
        required={3}
        timeZone={TZ}
      />,
    );
    expect(
      screen.getByRole('figure', { name: 'Filled went from 0 to 2 between 3:01 p.m. and 3:05 p.m.' }),
    ).toBeInTheDocument();
  });

  it('draws a dotted projection to the required count until the shift is full', () => {
    const { rerender } = render(
      <FilledChart events={[ev(1, 'accept', '20:01')]} filled={1} required={3} timeZone={TZ} />,
    );
    expect(screen.getByTestId('filled-projection')).toBeInTheDocument();

    rerender(
      <FilledChart
        events={[ev(1, 'accept', '20:01'), ev(2, 'accept', '20:02'), ev(3, 'accept', '20:03')]}
        filled={3}
        required={3}
        timeZone={TZ}
      />,
    );
    expect(screen.queryByTestId('filled-projection')).toBeNull();
    expect(chartText()).toHaveTextContent(
      'Filled went from 0 to 3 between 3:01 p.m. and 3:03 p.m. All places filled.',
    );
  });

  it('shows a flat line at 0 and "No changes yet" for an empty log', () => {
    render(<FilledChart events={[ev(1, 'invite', '20:00')]} filled={0} required={3} timeZone={TZ} />);
    expect(chartText()).toHaveTextContent('No changes yet.');
    expect(screen.getByTestId('filled-projection')).toBeInTheDocument();
  });
});

describe('Filled over time on the manager dashboard', () => {
  async function liveManager() {
    const api = fakeApi(makeSnapshot());
    const t = fakeTransport();
    renderApp('/manager', { transport: t.transport });
    await findWorkerCard('Amara Okafor');
    await act(async () => t.last.subscribed());
    const staffing = screen.getByRole('region', { name: 'Staffing' });
    await within(staffing).findByText('No changes yet.');
    return { api, t, staffing };
  }

  it('updates when a live event arrives', async () => {
    const { api, t, staffing } = await liveManager();
    await act(async () => t.last.send(api.act('amara', 'invite')));
    await act(async () => t.last.send(api.act('amara', 'accept')));
    await vi.waitFor(() =>
      expect(within(staffing).getByTestId('filled-chart-text')).toHaveTextContent(/from 0 to 1/),
    );
  });

  it('catches up after an outage', async () => {
    const { api, t, staffing } = await liveManager();
    await userEvent.click(screen.getByRole('switch', { name: /simulate outage/i }));
    api.act('amara', 'invite');
    api.act('amara', 'accept');
    api.act('liam', 'invite');
    api.act('liam', 'accept');
    await userEvent.click(screen.getByRole('switch', { name: /simulate outage/i }));
    await act(async () => t.last.subscribed());
    await vi.waitFor(() =>
      expect(within(staffing).getByTestId('filled-chart-text')).toHaveTextContent(/from 0 to 2/),
    );
  });
});
