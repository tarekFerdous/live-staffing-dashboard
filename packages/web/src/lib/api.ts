import {
  ApiErrorSchema,
  SnapshotSchema,
  WorkerSchema,
  type Action,
  type Snapshot,
  type Worker,
} from '@staffing/domain';
import { z } from 'zod';

/** The one seeded shift this app shows. */
export const SHIFT_ID: string = import.meta.env.VITE_SHIFT_ID ?? 'harbourfront-gala';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.", null, 'NETWORK');
  }
  const body: unknown = await res.json().catch(() => null);
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

const ActionResponseSchema = z.object({ worker: WorkerSchema, seq: z.number().optional() });

/**
 * One call per attempt. `idempotencyKey` identifies the user's intent: retries of
 * the same click reuse it, so the server applies the action at most once.
 */
export async function postAction(
  shiftId: string,
  workerId: string,
  body: { action: Action; expectedVersion?: number },
  idempotencyKey: string,
): Promise<Worker> {
  const res = await request(
    `/api/shifts/${encodeURIComponent(shiftId)}/workers/${encodeURIComponent(workerId)}/actions`,
    ActionResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    },
  );
  return res.worker;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
