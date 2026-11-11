import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detail,
  findWorkerCard,
  jsonResponse,
  makeSnapshot,
  renderApp,
  stubFetch,
  worker,
  workerCard,
} from '../test/render';

afterEach(() => vi.unstubAllGlobals());

/** Snapshot reads only (the activity timeline reads the event log separately). */
const snapshotReads = (fetch: ReturnType<typeof stubFetch>) =>
  (fetch.mock.calls as unknown as [string][]).filter(([url]) => !url.includes('/events')).length;

describe('manager page', () => {
  it('renders the shift details, a card per worker and the counts', async () => {
    const fetch = stubFetch(jsonResponse(200, makeSnapshot()));
    renderApp('/manager');

    expect(
      await screen.findByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' }),
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/shifts/harbourfront-gala', expect.anything());
    expect(screen.getByText('Harbourfront Centre')).toBeInTheDocument();

    const workers = within(screen.getByRole('region', { name: 'Workers' })).getAllByRole('region');
    expect(workers.map((w) => within(w).getByRole('heading').textContent)).toEqual([
      'Amara Okafor',
      'Liam Chen',
      'Sofia Rossi',
    ]);
    const amara = workerCard('Amara Okafor');
    expect(detail(amara, 'Participation')).toHaveTextContent('Uninvited');
    expect(detail(amara, 'Attendance')).toHaveTextContent('Not started');
    expect(within(amara).getByTestId('tracker')).toHaveTextContent('Not invited');
    expect(amara).toHaveTextContent('Not invited yet.');
    for (const label of ['Invited', 'Responded', 'Checked in', 'Checked out']) {
      expect(detail(amara, label)).toHaveTextContent('—');
    }
    expect(within(amara).getByRole('button', { name: 'Invite Amara Okafor' })).toBeEnabled();

    expect(screen.getByTestId('count-filled')).toHaveTextContent('0');
    expect(screen.getByTestId('count-remaining')).toHaveTextContent('3');
    expect(screen.getByTestId('count-checked-in')).toHaveTextContent('0');
    expect(screen.getByTestId('count-checked-out')).toHaveTextContent('0');

    const staffing = screen.getByRole('region', { name: 'Staffing' });
    expect(staffing).toHaveTextContent('No places filled yet. 3 places to go.');
    const shift = screen.getByRole('region', { name: 'Winter Gala — Bar & Floor Staff' });
    expect(within(shift).getByTestId('shift-time')).toHaveTextContent(/5:00\sp\.m\..*to\s11:00\sp\.m\./);
    expect(within(shift).getByTestId('shift-date')).toHaveTextContent('Saturday, December 12, 2026');
    expect(within(shift).getByTestId('shift-timezone')).toHaveTextContent('EST (America/Toronto)');
    expect(screen.getByRole('region', { name: 'Activity' })).toBeInTheDocument();
  });

  it('derives counts from the rows, ignoring the server acceptedCount', async () => {
    const snapshot = makeSnapshot(
      [
        worker('a', 'A', {
          participation: 'accepted',
          attendance: 'checked_in',
          checkedInAt: '2026-12-12T22:05:00.000Z',
        }),
        worker('b', 'B', {
          participation: 'accepted',
          attendance: 'checked_out',
          checkedInAt: '2026-12-12T22:01:00.000Z',
          checkedOutAt: '2026-12-13T03:30:00.000Z',
        }),
        worker('c', 'C', { participation: 'declined' }),
      ],
      { acceptedCount: 0 }, // deliberately wrong: the page must not trust it
    );
    stubFetch(jsonResponse(200, snapshot));
    renderApp('/manager');

    expect(await screen.findByTestId('count-filled')).toHaveTextContent('2');
    expect(screen.getByTestId('count-remaining')).toHaveTextContent('1');
    expect(screen.getByTestId('count-checked-in')).toHaveTextContent('1');
    expect(screen.getByTestId('count-checked-out')).toHaveTextContent('1');
    expect(screen.getByRole('region', { name: 'Staffing' })).toHaveTextContent(
      '2 of 3 places filled. 1 checked in, 1 checked out.',
    );
    // Check-in time shown in the shift's timezone (22:05Z = 5:05 p.m. Toronto).
    expect(detail(workerCard('A'), 'Checked in')).toHaveTextContent(/5:05\sp\.m\./);
    expect(workerCard('A')).toHaveTextContent('Checked in at 5:05 p.m.');
    expect(within(workerCard('B')).getByTestId('tracker')).toHaveTextContent('Step 4 of 4: Checked out');
    expect(within(workerCard('C')).getByTestId('tracker')).toHaveTextContent('Step 2 of 4: Declined');
  });

  it("formats times in the shift's IANA timezone, not the browser's", async () => {
    stubFetch(
      jsonResponse(
        200,
        makeSnapshot(undefined, {
          timezone: 'Asia/Tokyo',
          startsAt: '2026-12-12T22:00:00.000Z', // 07:00 on Dec 13 in Tokyo
          endsAt: '2026-12-13T04:00:00.000Z', // 13:00 in Tokyo
        }),
      ),
    );
    renderApp('/manager');

    expect(await screen.findByTestId('shift-date')).toHaveTextContent('Sunday, December 13, 2026');
    expect(screen.getByTestId('shift-time')).toHaveTextContent(/7:00\sa\.m\..*to\s1:00\sp\.m\./);
    expect(screen.getByTestId('shift-timezone')).toHaveTextContent('GMT+9 (Asia/Tokyo)');
  });

  it('shows a clear error with a retry button when the API is unreachable, and recovers', async () => {
    const fetch = stubFetch(new TypeError('Failed to fetch'), jsonResponse(200, makeSnapshot()));
    renderApp('/manager');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach the server");
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' }),
    ).toBeInTheDocument();
    expect(snapshotReads(fetch)).toBe(2);
  });

  it("shows the server's message for an unknown shift", async () => {
    stubFetch(
      jsonResponse(404, { code: 'SHIFT_NOT_FOUND', message: 'Shift "harbourfront-gala" was not found.' }),
    );
    renderApp('/manager');
    expect(await screen.findByRole('alert')).toHaveTextContent('Shift "harbourfront-gala" was not found.');
  });

  it('loads saved state from the API on every fresh page load', async () => {
    const saved = makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'invited' })]);
    const fetch = stubFetch(jsonResponse(200, saved));
    const first = renderApp('/manager');
    expect(within(await findWorkerCard('Amara Okafor')).getByTestId('tracker')).toHaveTextContent('Invited');
    first.unmount();

    renderApp('/manager'); // a refresh: new query cache, same backend state
    expect(within(await findWorkerCard('Amara Okafor')).getByTestId('tracker')).toHaveTextContent('Invited');
    expect(snapshotReads(fetch)).toBe(2);
  });
});
