import type { Shift, Worker } from '@staffing/domain';
import { META_SK, shiftPk, workerSk } from './keys';

export type SeedData = {
  shift: Omit<Shift, 'acceptedCount'>;
  workers: Pick<Worker, 'id' | 'name'>[];
};

export const SEED_SHIFT_ID = 'harbourfront-gala';

export const SEED: SeedData = {
  shift: {
    id: SEED_SHIFT_ID,
    title: 'Winter Gala — Bar & Floor Staff',
    location: 'Harbourfront Centre, 235 Queens Quay W, Toronto',
    // 17:00–23:00 America/Toronto (EST, UTC−5)
    startsAt: '2026-12-12T22:00:00.000Z',
    endsAt: '2026-12-13T04:00:00.000Z',
    timezone: 'America/Toronto',
    required: 3,
  },
  workers: [
    { id: 'amara', name: 'Amara Okafor' },
    { id: 'liam', name: 'Liam Chen' },
    { id: 'sofia', name: 'Sofia Rossi' },
  ],
};

/** The exact DynamoDB items a freshly reset shift partition holds. */
export function seedItems(seed: SeedData = SEED): Record<string, unknown>[] {
  const pk = shiftPk(seed.shift.id);
  return [
    { PK: pk, SK: META_SK, type: 'shift', ...seed.shift, seq: 0, acceptedCount: 0 },
    ...seed.workers.map((w) => ({
      PK: pk,
      SK: workerSk(w.id),
      type: 'worker',
      id: w.id,
      name: w.name,
      participation: 'uninvited',
      attendance: 'not_started',
      invitedAt: null,
      respondedAt: null,
      checkedInAt: null,
      checkedOutAt: null,
      version: 0,
    })),
  ];
}
