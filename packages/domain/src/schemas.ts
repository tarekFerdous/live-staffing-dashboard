// zod/mini: the same validation core as zod 4's classic API, in a form bundlers can tree-shake.
// The browser parses every API response with these schemas, and mini is about a third the size
// of classic in the bundle (#89). Error messages are identical; schemas.test.ts pins them.
import * as z from 'zod/mini';
// English alone: `z.locales.en` would bundle every locale (~260 KB) into each Lambda.
import en from 'zod/v4/locales/en.js';
import { ATTENDANCES, PARTICIPATIONS } from './statuses';
import { ACTIONS } from './transitions';

const isoInstant = z.iso.datetime({ offset: true });
const nonEmpty = () => z.string().check(z.minLength(1));
const count = () => z.number().check(z.int(), z.nonnegative());
const positiveInt = () => z.number().check(z.int(), z.positive());

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
    id: nonEmpty(),
    title: nonEmpty(),
    location: nonEmpty(),
    startsAt: isoInstant,
    endsAt: isoInstant,
    timezone: z.string().check(z.refine(isIanaTimeZone, 'must be an IANA timezone')),
    required: positiveInt(),
    acceptedCount: count(),
  })
  .check(
    z.refine((s) => Date.parse(s.endsAt) > Date.parse(s.startsAt), {
      message: 'endsAt must be after startsAt',
      path: ['endsAt'],
    }),
  );
export type Shift = z.infer<typeof ShiftSchema>;

export const WorkerSchema = z.object({
  id: nonEmpty(),
  name: nonEmpty(),
  // Profile details (made-up demo data). Defaulted so rows stored before they existed still parse.
  role: z._default(z.string(), ''),
  phone: z._default(z.string(), ''),
  email: z._default(z.string(), ''),
  address: z._default(z.string(), ''),
  participation: z.enum(PARTICIPATIONS),
  attendance: z.enum(ATTENDANCES),
  invitedAt: z.nullable(isoInstant),
  respondedAt: z.nullable(isoInstant),
  checkedInAt: z.nullable(isoInstant),
  checkedOutAt: z.nullable(isoInstant),
  version: count(),
});
export type Worker = z.infer<typeof WorkerSchema>;

export const SnapshotSchema = z.object({
  shift: ShiftSchema,
  workers: z.array(WorkerSchema),
  seq: count(),
  /**
   * Bumped by every reset. `seq` restarts at 0 after a reset, so a newer epoch (not a higher
   * seq) is what tells a page that its state is from before the reset.
   */
  epoch: count(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/**
 * One committed change, as served by the catch-up API and pushed live.
 * `row` is the complete worker row after the change; `publishedAt` is only set on live pushes.
 */
export const ShiftEventSchema = z.object({
  seq: positiveInt(),
  type: z.enum(ACTIONS),
  workerId: nonEmpty(),
  row: WorkerSchema,
  at: isoInstant,
  publishedAt: z.optional(isoInstant),
  /** `'event'` on live pushes; a message without `kind` is also an event (older publishers). */
  kind: z.optional(z.literal('event')),
  /**
   * The shift's epoch when the change was made. A page drops events from an older epoch, so a
   * change delivered late from before a reset can never be applied on top of the reset shift.
   * Absent on events written before epochs existed.
   */
  epoch: z.optional(count()),
});
export type ShiftEventMessage = z.infer<typeof ShiftEventSchema>;

/** Most events the catch-up API returns in one page; a bigger gap falls back to the snapshot. */
export const MAX_EVENTS_PAGE = 200;

export const EventsPageSchema = z.object({
  events: z.array(ShiftEventSchema),
  /** True when more events exist after the last one returned. */
  hasMore: z.boolean(),
  /** The shift's current epoch, so a page that missed a reset notices it on catch-up. */
  epoch: count(),
});
export type EventsPage = z.infer<typeof EventsPageSchema>;

export const ActionRequestSchema = z.strictObject({
  action: z.enum(ACTIONS),
  expectedVersion: z.optional(count()),
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/** zod 3's name for the type of a value, as its messages used it. */
function receivedType(input: unknown): string {
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  if (typeof input === 'number')
    return Number.isNaN(input) ? 'nan' : Number.isInteger(input) ? 'number' : 'float';
  return typeof input;
}

/**
 * Words validation messages as the API has always sent them (zod 3's wording), so the 422 bodies
 * clients see didn't change with the move to zod 4. Pass it as `safeParse(input, { error: apiErrorMap })`;
 * anything it doesn't cover falls back to zod's own message.
 */
export const apiErrorMap: z.core.$ZodErrorMap = (iss) => {
  const quote = (v: unknown) => `'${String(v)}'`;
  if (iss.input === undefined && (iss.code === 'invalid_type' || iss.code === 'invalid_value'))
    return 'Required';
  switch (iss.code) {
    case 'invalid_value':
      return `Invalid enum value. Expected ${iss.values.map(quote).join(' | ')}, received ${quote(iss.input)}`;
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${iss.keys.map(quote).join(', ')}`;
    case 'too_small':
      if (iss.origin === 'number')
        return `Number must be greater than ${iss.inclusive ? 'or equal to ' : ''}${String(iss.minimum)}`;
      return undefined;
    case 'invalid_type': {
      const received = receivedType(iss.input);
      if (iss.expected === 'int') return `Expected integer, received ${received}`;
      return `Expected ${iss.expected}, received ${received}`;
    }
    default:
      return undefined;
  }
};

/**
 * zod/mini registers no message locale, so a failed parse reads "Invalid input". The server calls
 * this once so its logs keep zod's English messages; the browser skips it (its users only ever
 * see a generic message) and doesn't download the locale.
 */
export function registerEnglishMessages(): void {
  z.config(en());
}

/**
 * `GET /api/config`: tells one client build where its live channel is.
 * `realtime.url` is the WebSocket URL; a path (local mode) is resolved against the page's origin.
 * `realtime: null` means live updates are off and the page refetches after actions.
 */
export const RuntimeConfigSchema = z.object({
  mode: z.enum(['local', 'cloud']),
  realtime: z.nullable(
    z.object({
      url: nonEmpty(),
      /** Host named in the connection's auth header (the AppSync HTTP host in the cloud). */
      httpHost: nonEmpty(),
      /** Subscribe-only key. */
      apiKey: nonEmpty(),
    }),
  ),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/** `POST /api/demo/reset` → every seeded shift with its new epoch. */
export const DemoResetResponseSchema = z.object({
  shifts: z.array(z.object({ id: nonEmpty(), epoch: positiveInt() })),
});
export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;

/** Live messages on a shift's channel: an event, or "the shift was reset to `epoch`". */
export const ResetMessageSchema = z.object({ kind: z.literal('reset'), epoch: positiveInt() });
export type ResetMessage = z.infer<typeof ResetMessageSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
