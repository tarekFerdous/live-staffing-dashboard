import type { ShiftEventMessage } from '@staffing/domain';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakeApi';
import { fakeTransport } from '../test/fakeTransport';
import { findWorkerCard, makeSnapshot, renderApp, worker } from '../test/render';
import { StaffingChart } from './StaffingChart';

afterEach(() => vi.unstubAllGlobals());

const TZ = 'America/Toronto';
const ev = (seq: number, type: ShiftEventMessage['type'], hhmm: string): ShiftEventMessage => ({
  seq,
  type,
  workerId: `w${seq}`,
  row: worker(`w${seq}`, `W${seq}`),
  at: `2026-12-12T${hhmm}:00.000Z`, // UTC; Toronto is UTC−5
});

const chartText = () => screen.getByTestId('chart-text');
const chartTitle = () => screen.getByTestId('chart-title');
const projection = () => screen.queryByTestId('chart-projection');
const yLabels = () => screen.getAllByTestId('y-tick').map((t) => t.textContent);

// A day's log: two accepts, one check-in, one check-out.
const LOG = [
  ev(1, 'invite', '20:00'),
  ev(2, 'accept', '20:01'),
  ev(3, 'accept', '20:05'),
  ev(4, 'check_in', '21:00'),
  ev(5, 'check_out', '22:00'),
];

describe('StaffingChart', () => {
  it('has a text alternative a screen reader can read', () => {
    render(<StaffingChart category="filled" events={LOG} current={2} required={3} timeZone={TZ} />);
    expect(
      screen.getByRole('figure', { name: 'Filled went from 0 to 2 between 3:01 p.m. and 3:05 p.m.' }),
    ).toBeInTheDocument();
    expect(chartTitle()).toHaveTextContent('Filled over time');
  });

  it.each([
    ['remaining', 1, 'Remaining over time', 'Remaining went from 3 to 1 between 3:01 p.m. and 3:05 p.m.'],
    ['checkedIn', 0, 'Checked in over time', 'Checked in was back at 0 between 4:00 p.m. and 5:00 p.m.'],
    ['checkedOut', 1, 'Checked out over time', 'Checked out went from 0 to 1 at 5:00 p.m.'],
  ] as const)('names the %s category in its heading and caption', (category, current, title, caption) => {
    render(<StaffingChart category={category} events={LOG} current={current} required={3} timeZone={TZ} />);
    expect(chartTitle()).toHaveTextContent(title);
    expect(chartText()).toHaveTextContent(caption);
    expect(screen.getByRole('figure', { name: caption })).toBeInTheDocument();
  });

  it('draws a dotted projection to the required count until the shift is full', () => {
    const { rerender } = render(
      <StaffingChart
        category="filled"
        events={[ev(1, 'accept', '20:01')]}
        current={1}
        required={3}
        timeZone={TZ}
      />,
    );
    expect(projection()).toBeInTheDocument();

    rerender(
      <StaffingChart
        category="filled"
        events={[ev(1, 'accept', '20:01'), ev(2, 'accept', '20:02'), ev(3, 'accept', '20:03')]}
        current={3}
        required={3}
        timeZone={TZ}
      />,
    );
    expect(projection()).toBeNull();
    expect(chartText()).toHaveTextContent(
      'Filled went from 0 to 3 between 3:01 p.m. and 3:03 p.m. All places filled.',
    );
  });

  it('projects Remaining down to 0 until nothing is left, and never Checked in or Checked out', () => {
    const { rerender } = render(
      <StaffingChart category="remaining" events={LOG} current={1} required={3} timeZone={TZ} />,
    );
    expect(projection()).toBeInTheDocument();
    rerender(<StaffingChart category="remaining" events={LOG} current={0} required={2} timeZone={TZ} />);
    expect(projection()).toBeNull();
    expect(chartText()).not.toHaveTextContent('All places filled');

    for (const category of ['checkedIn', 'checkedOut'] as const) {
      rerender(<StaffingChart category={category} events={LOG} current={1} required={3} timeZone={TZ} />);
      expect(projection()).toBeNull();
    }
  });

  it('shows "No changes yet." for a category nothing has moved', () => {
    const { rerender } = render(
      <StaffingChart
        category="filled"
        events={[ev(1, 'invite', '20:00')]}
        current={0}
        required={3}
        timeZone={TZ}
      />,
    );
    expect(chartText()).toHaveTextContent('No changes yet.');
    expect(projection()).toBeInTheDocument();
    rerender(
      <StaffingChart
        category="checkedIn"
        events={[ev(1, 'accept', '20:00')]}
        current={0}
        required={3}
        timeZone={TZ}
      />,
    );
    expect(chartText()).toHaveTextContent('No changes yet.');
  });

  it('labels every whole number on the Y axis for the demo shift', () => {
    render(<StaffingChart category="filled" events={LOG} current={2} required={3} timeZone={TZ} />);
    expect(yLabels()).toEqual(['0', '1', '2', '3']);
  });

  it('thins the Y labels out for a big shift', () => {
    render(<StaffingChart category="filled" events={[]} current={0} required={20} timeZone={TZ} />);
    expect(yLabels()).toEqual(['0', '5', '10', '15', '20']);
  });
});

describe('Staffing tiles and chart on the manager dashboard', () => {
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
  const tile = (staffing: HTMLElement, name: string) =>
    within(within(staffing).getByRole('group', { name: 'Shift summary' })).getByRole('button', {
      name: new RegExp(`^${name}`),
    });
  const pressed = (staffing: HTMLElement) =>
    within(staffing)
      .getAllByRole('button', { pressed: true })
      .map((b) => b.textContent);

  it('starts on Filled; clicking a tile selects it and switches the chart', async () => {
    const { staffing } = await liveManager();
    expect(pressed(staffing)).toEqual(['Filled0/ 3']);
    expect(within(staffing).getByTestId('chart-title')).toHaveTextContent('Filled over time');

    for (const [name, title] of [
      ['Remaining', 'Remaining over time'],
      ['Checked in', 'Checked in over time'],
      ['Checked out', 'Checked out over time'],
      ['Filled', 'Filled over time'],
    ] as const) {
      await userEvent.click(tile(staffing, name));
      expect(tile(staffing, name)).toHaveAttribute('aria-pressed', 'true');
      expect(within(staffing).getAllByRole('button', { pressed: true })).toHaveLength(1);
      expect(within(staffing).getByTestId('chart-title')).toHaveTextContent(title);
    }
  });

  it('moves between tiles with the arrow keys and selects with Enter or Space', async () => {
    const { staffing } = await liveManager();
    tile(staffing, 'Filled').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tile(staffing, 'Remaining')).toHaveFocus();
    expect(tile(staffing, 'Filled')).toHaveAttribute('aria-pressed', 'true'); // moving doesn't select
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(tile(staffing, 'Checked in')).toHaveAttribute('aria-pressed', 'true');
    expect(within(staffing).getByTestId('chart-title')).toHaveTextContent('Checked in over time');
    await userEvent.keyboard('{End} ');
    expect(tile(staffing, 'Checked out')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.keyboard('{Home}{ArrowLeft}');
    expect(tile(staffing, 'Filled')).toHaveFocus();
  });

  it('updates the selected chart when a live event arrives', async () => {
    const { api, t, staffing } = await liveManager();
    await userEvent.click(tile(staffing, 'Checked in'));
    await act(async () => t.last.send(api.act('amara', 'invite')));
    await act(async () => t.last.send(api.act('amara', 'accept')));
    await act(async () => t.last.send(api.act('amara', 'check_in')));
    await vi.waitFor(() =>
      expect(within(staffing).getByTestId('chart-text')).toHaveTextContent(/Checked in went from 0 to 1/),
    );
    expect(within(staffing).getByTestId('count-checked-in')).toHaveTextContent('1');
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
      expect(within(staffing).getByTestId('chart-text')).toHaveTextContent(/Filled went from 0 to 2/),
    );
  });
});
