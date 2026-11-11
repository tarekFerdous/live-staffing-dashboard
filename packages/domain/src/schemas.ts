import { z } from 'zod';
import { ATTENDANCES, PARTICIPATIONS } from './statuses';
import { ACTIONS } from './transitions';

const isoInstant = z.string().datetime({ offset: true });

function isIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const ShiftSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    location: z.string().min(1),
    startsAt: isoInstant,
    endsAt: isoInstant,
    timezone: z.string().refine(isIanaTimeZone, 'must be an IANA timezone'),
    required: z.number().int().positive(),
    acceptedCount: z.number().int().nonnegative(),
  })
  .refine((s) => Date.parse(s.endsAt) > Date.parse(s.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
export type Shift = z.infer<typeof ShiftSchema>;

export const WorkerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  participation: z.enum(PARTICIPATIONS),
  attendance: z.enum(ATTENDANCES),
  invitedAt: isoInstant.nullable(),
  respondedAt: isoInstant.nullable(),
  checkedInAt: isoInstant.nullable(),
  checkedOutAt: isoInstant.nullable(),
  version: z.number().int().nonnegative(),
});
export type Worker = z.infer<typeof WorkerSchema>;

export const SnapshotSchema = z.object({
  shift: ShiftSchema,
  workers: z.array(WorkerSchema),
  seq: z.number().int().nonnegative(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * One committed change, as served by the catch-up API and pushed live.
 * `row` is the complete worker row after the change; `publishedAt` is only set on live pushes.
 */
export const ShiftEventSchema = z.object({
  seq: z.number().int().positive(),
  type: z.enum(ACTIONS),
  workerId: z.string().min(1),
  row: WorkerSchema,
  at: isoInstant,
  publishedAt: isoInstant.optional(),
});
export type ShiftEventMessage = z.infer<typeof ShiftEventSchema>;

/** Most events the catch-up API returns in one page; a bigger gap falls back to the snapshot. */
export const MAX_EVENTS_PAGE = 200;

export const EventsPageSchema = z.object({
  events: z.array(ShiftEventSchema),
  /** True when more events exist after the last one returned. */
  hasMore: z.boolean(),
});
export type EventsPage = z.infer<typeof EventsPageSchema>;

export const ActionRequestSchema = z
  .object({
    action: z.enum(ACTIONS),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/**
 * `GET /api/config`: tells one client build where its live channel is.
 * `realtime.url` is the WebSocket URL; a path (local mode) is resolved against the page's origin.
 * `realtime: null` means live updates are off and the page refetches after actions.
 */
export const RuntimeConfigSchema = z.object({
  mode: z.enum(['local', 'cloud']),
  realtime: z
    .object({
      url: z.string().min(1),
      /** Host named in the connection's auth header (the AppSync HTTP host in the cloud). */
      httpHost: z.string().min(1),
      /** Subscribe-only key. */
      apiKey: z.string().min(1),
    })
    .nullable(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
