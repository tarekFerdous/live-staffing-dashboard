import { MAX_EVENTS_PAGE, type EventsPage } from '@staffing/domain';
import type { ShiftStore } from '@staffing/store';
import { error, json, withErrors, type HttpHandler } from './http';

/**
 * GET /api/shifts/{shiftId}/events?after=<seq>[&read=eventual] → `{ events, hasMore, epoch }`.
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

    // #92: `read=eventual` marks a routine periodic check, which may read at half the cost; it can lag
    // a moment behind, and the client never lets that roll its page back. Strong by default.
    const read = event.queryStringParameters?.read ?? 'strong';
    if (read !== 'strong' && read !== 'eventual') {
      return error(422, 'VALIDATION_FAILED', "Invalid request. read: must be 'strong' or 'eventual'.");
    }

    // #91: the events and the epoch come from one Query, so they are a consistent pair.
    const { events, hasMore, epoch } = await store.readEventsAndEpoch(shiftId, Number(raw), MAX_EVENTS_PAGE, {
      consistent: read === 'strong',
    });
    if (epoch === null) return error(404, 'SHIFT_NOT_FOUND', `Shift "${shiftId}" was not found.`);
    const page: EventsPage = {
      epoch,
      events: events.map(({ seq, type, workerId, row, at, epoch: e }) => ({
        seq,
        type,
        workerId,
        row,
        at,
        ...(e !== undefined && { epoch: e }),
      })),
      hasMore,
    };
    return json(200, page);
  });
}
