import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, makeSnapshot, renderApp, stubFetch, worker } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

describe('manager page', () => {
  it('renders the shift details, the worker table and the counts', async () => {
    const fetch = stubFetch(jsonResponse(200, makeSnapshot()));
    renderApp('/manager');

    expect(await screen.findByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/shifts/harbourfront-gala', expect.anything());
    expect(screen.getByText('Harbourfront Centre')).toBeInTheDocument();

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + three workers
    expect(within(rows[1]!).getByRole('rowheader')).toHaveTextContent('Amara Okafor');
    expect(rows[1]).toHaveTextContent('Uninvited');
    expect(rows[1]).toHaveTextContent('Not started');

    expect(screen.getByTestId('count-filled')).toHaveTextContent('0');
    expect(screen.getByTestId('count-remaining')).toHaveTextContent('3');
    expect(screen.getByTestId('count-checked-in')).toHaveTextContent('0');
    expect(screen.getByTestId('count-checked-out')).toHaveTextContent('0');
  });

  it('derives counts from the rows, ignoring the server acceptedCount', async () => {
    const snapshot = makeSnapshot(
      [
        worker('a', 'A', { participation: 'accepted', attendance: 'checked_in', checkedInAt: '2026-12-12T22:05:00.000Z' }),
        worker('b', 'B', { participation: 'accepted', attendance: 'checked_out', checkedInAt: '2026-12-12T22:01:00.000Z', checkedOutAt: '2026-12-13T03:30:00.000Z' }),
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
    // Check-in time shown in the shift's timezone (22:05Z = 5:05 p.m. Toronto).
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(/5:05\sp\.m\./);
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
    expect(screen.getByTestId('shift-time')).toHaveTextContent(/7:00\sa\.m\.\s–\s1:00\sp\.m\.\sGMT\+9/);
  });

  it('shows a clear error with a retry button when the API is unreachable, and recovers', async () => {
    const fetch = stubFetch(new TypeError('Failed to fetch'), jsonResponse(200, makeSnapshot()));
    renderApp('/manager');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach the server");
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Winter Gala — Bar & Floor Staff' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shows the server's message for an unknown shift", async () => {
    stubFetch(jsonResponse(404, { code: 'SHIFT_NOT_FOUND', message: 'Shift "harbourfront-gala" was not found.' }));
    renderApp('/manager');
    expect(await screen.findByRole('alert')).toHaveTextContent('Shift "harbourfront-gala" was not found.');
  });

  it('loads saved state from the API on every fresh page load', async () => {
    const saved = makeSnapshot([worker('amara', 'Amara Okafor', { participation: 'invited' })]);
    const fetch = stubFetch(jsonResponse(200, saved));
    const first = renderApp('/manager');
    expect(await screen.findByText('Invited')).toBeInTheDocument();
    first.unmount();

    renderApp('/manager'); // a refresh: new query cache, same backend state
    expect(await screen.findByText('Invited')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
