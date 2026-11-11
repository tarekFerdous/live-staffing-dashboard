import { ApiErrorSchema, SnapshotSchema, type Snapshot } from '@staffing/domain';

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

export async function fetchSnapshot(shiftId: string, signal?: AbortSignal): Promise<Snapshot> {
  let res: Response;
  try {
    res = await fetch(`/api/shifts/${encodeURIComponent(shiftId)}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.", null, 'NETWORK');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(parsed.data.message, res.status, parsed.data.code)
      : new ApiError(`The server answered with an error (${res.status}). Please try again.`, res.status, 'HTTP');
  }
  const parsed = SnapshotSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('The server sent data this page does not understand.', res.status, 'BAD_DATA');
  return parsed.data;
}
