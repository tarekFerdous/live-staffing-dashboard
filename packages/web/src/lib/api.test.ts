import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '../test/render';
import { fetchEvents } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('#92 fetchEvents read mode', () => {
  it('asks for a strong read by default and an eventual one only when told to', async () => {
    const fetch = stubFetch(jsonResponse(200, { events: [], hasMore: false, epoch: 1 }));
    await fetchEvents('gala', 3);
    await fetchEvents('gala', 3, { eventual: true });
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/shifts/gala/events?after=3',
      '/api/shifts/gala/events?after=3&read=eventual',
    ]);
  });
});
