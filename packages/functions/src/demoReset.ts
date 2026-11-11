import type { DemoResetResponse } from '@staffing/domain';
import type { SeedData, ShiftStore } from '@staffing/store';
import { json, withErrors, type HttpHandler } from './http';

/**
 * POST /api/demo/reset → `200 { shifts: [{ id, epoch }] }`: puts every seeded shift back to
 * its starting state and bumps its epoch, which resets every open page through the live channel.
 *
 * No body, no auth and no idempotency key: a repeated press simply resets again. This is a
 * demo affordance; a real product would gate it behind an admin role or remove it.
 */
export function makeDemoResetHandler(deps: { store: ShiftStore; seeds: readonly SeedData[] }): HttpHandler {
  return withErrors(async () => {
    const shifts: DemoResetResponse['shifts'] = [];
    for (const seed of deps.seeds) {
      shifts.push({ id: seed.shift.id, epoch: await deps.store.resetShift(seed) });
    }
    return json(200, { shifts } satisfies DemoResetResponse);
  });
}
