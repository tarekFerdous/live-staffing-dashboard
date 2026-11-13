import {
  ApiErrorSchema,
  DemoResetResponseSchema,
  type DemoResetResponse,
  EventsPageSchema,
  SnapshotSchema,
  WorkerSchema,
  type Action,
  type EventsPage,
  type Snapshot,
} from '@staffing/domain';
import * as z from 'zod/mini';

/** The one seeded shift this app shows. */
export const SHIFT_ID: string = import.meta.env.VITE_SHIFT_ID ?? 'harbourfront-gala';

export const THROTTLED_MESSAGE = 'Too many requests, try again';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(
  url: string,
  schema: z.ZodMiniType<T, unknown>,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.", null, 'NETWORK');
  }
  const body: unknown = await res.json().catch(() => null);
  // API Gateway answers a throttled request itself, with its own body: one clear, temporary message.
  if (res.status === 429) throw new ApiError(THROTTLED_MESSAGE, 429, 'THROTTLED');
  if (res.status === 413)
    throw new ApiError("This request isn't valid. Please try again.", 413, 'INVALID_REQUEST');
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(parsed.data.message, res.status, parsed.data.code)
      : new ApiError(
          `The server answered with an error (${res.status}). Please try again.`,
          res.status,
          'HTTP',
        );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError('The server sent data this page does not understand.', res.status, 'BAD_DATA');
  return parsed.data;
}

export function fetchSnapshot(shiftId: string, signal?: AbortSignal): Promise<Snapshot> {
  return request(`/api/shifts/${encodeURIComponent(shiftId)}`, SnapshotSchema, { signal });
}

/**
 * Committed changes after `afterSeq`, oldest first (one page; `hasMore` means load the snapshot).
 * `eventual` lets the server read eventually consistently: for routine periodic checks only.
 */
export function fetchEvents(
  shiftId: string,
  afterSeq: number,
  { eventual = false }: { eventual?: boolean } = {},
): Promise<EventsPage> {
  const read = eventual ? '&read=eventual' : '';
  return request(
    `/api/shifts/${encodeURIComponent(shiftId)}/events?after=${afterSeq}${read}`,
    EventsPageSchema,
  );
}

const ActionResponseSchema = z.object({
  worker: WorkerSchema,
  seq: z.optional(z.number().check(z.int(), z.positive())),
});
export type ActionResponse = z.infer<typeof ActionResponseSchema>;

/**
 * One call per attempt. `idempotencyKey` identifies the user's intent: retries of
 * the same click reuse it, so the server applies the action at most once.
 */
export async function postAction(
  shiftId: string,
  workerId: string,
  body: { action: Action; expectedVersion?: number },
  idempotencyKey: string,
): Promise<ActionResponse> {
  return request(
    `/api/shifts/${encodeURIComponent(shiftId)}/workers/${encodeURIComponent(workerId)}/actions`,
    ActionResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    },
  );
}

/** Puts the demo back to its seed. Open pages (this one included) reset through the live epoch. */
export function resetDemo(): Promise<DemoResetResponse> {
  return request('/api/demo/reset', DemoResetResponseSchema, { method: 'POST' });
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
