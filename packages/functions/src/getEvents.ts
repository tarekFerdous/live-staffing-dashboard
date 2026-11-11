import { MAX_EVENTS_PAGE, type EventsPage } from '@staffing/domain';
import type { ShiftStore } from '@staffing/store';
import { error, json, withErrors, type HttpHandler } from './http';

/**
 * GET /api/shifts/{shiftId}/events?after=<seq> → `{ events, hasMore }`.
 * Events are oldest first, at most MAX_EVENTS_PAGE of them; when `hasMore` is true
 * the client loads the snapshot instead of paging through the log.
 */
export function makeGetEventsHandler(store: ShiftStore): HttpHandler {
  return withErrors(async (event) => {
    const shiftId = event.pathParameters?.shiftId;
    if (!shiftId) return error(404, 'SHIFT_NOT_FOUND', 'No shift id was given.');

    const raw = event.queryStringParameters?.after ?? '0';
    if (!/^\d{1,15}$/.test(raw)) {
      return error(422, 'VALIDATION_FAILED', 'Invalid request. after: must be a whole number of 0 or more.');
    }

    // One extra item tells us whether more exist without a second read.
    const events = await store.listEvents(shiftId, Number(raw), MAX_EVENTS_PAGE + 1);
    const page: EventsPage = {
      events: events.slice(0, MAX_EVENTS_PAGE).map(({ seq, type, workerId, row, at }) => ({
        seq,
        type,
        workerId,
        row,
        at,
      })),
      hasMore: events.length > MAX_EVENTS_PAGE,
    };
    return json(200, page);
  });
}
