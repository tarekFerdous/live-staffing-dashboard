import type { ShiftStore } from '@staffing/store';
import { error, json, withErrors, type HttpHandler } from './http';

/** GET /api/shifts/{shiftId} → `{ shift, workers, seq }`. Counts are derived on the client. */
export function makeGetShiftHandler(store: ShiftStore): HttpHandler {
  return withErrors(async (event) => {
    const shiftId = event.pathParameters?.shiftId;
    if (!shiftId) return error(404, 'SHIFT_NOT_FOUND', 'No shift id was given.');
    const snapshot = await store.getSnapshot(shiftId);
    if (!snapshot) return error(404, 'SHIFT_NOT_FOUND', `Shift "${shiftId}" was not found.`);
    return json(200, snapshot);
  });
}
