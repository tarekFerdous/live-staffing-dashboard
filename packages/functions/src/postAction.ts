import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  IdempotencyAlreadyInProgressError,
  IdempotencyConfig,
  IdempotencyValidationError,
  makeIdempotent,
} from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { ActionRequestSchema, type ActionRequest } from '@staffing/domain';
import type { ActionOutcome, ShiftStore } from '@staffing/store';
import type { Context } from 'aws-lambda';
import { error, json, withErrors, type HttpEvent, type HttpResult } from './http';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type ActionHandlerDeps = {
  store: ShiftStore;
  idempotency: { client: DynamoDBClient; tableName: string };
  now?: () => string;
};

/**
 * Outside Lambda (local server, tests) there is no context; this minimal one lets
 * Powertools take the same handler path and size in-progress records as in Lambda.
 */
const LOCAL_CONTEXT = { getRemainingTimeInMillis: () => 10_000 } as Context;

/** Thrown inside the idempotent section so Powertools drops the record and a retry can run again. */
class BusyError extends Error {}

type Parsed =
  | { ok: true; shiftId: string; workerId: string; request: ActionRequest }
  | { ok: false; result: HttpResult };

function parse(event: HttpEvent): Parsed {
  const shiftId = event.pathParameters?.shiftId;
  const workerId = event.pathParameters?.workerId;
  if (!shiftId || !workerId) return { ok: false, result: error(404, 'NOT_FOUND', 'Unknown shift or worker.') };

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    return { ok: false, result: error(422, 'VALIDATION_FAILED', 'The request body must be JSON.') };
  }
  const parsed = ActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, result: error(422, 'VALIDATION_FAILED', `Invalid request. ${where}${issue?.message ?? ''}`.trim()) };
  }
  return { ok: true, shiftId, workerId, request: parsed.data };
}

function toHttp(outcome: ActionOutcome): HttpResult {
  switch (outcome.kind) {
    case 'applied':
      return json(200, { worker: outcome.worker, seq: outcome.seq });
    case 'already':
      return json(200, { worker: outcome.worker });
    case 'rejected':
      return json(409, { code: outcome.code, message: outcome.message, current: outcome.current });
    case 'not_found':
      return error(404, outcome.code, outcome.message);
    case 'busy':
      throw new BusyError();
  }
}

/**
 * POST /api/shifts/{shiftId}/workers/{workerId}/actions
 * Body `{ action, expectedVersion? }`, header `Idempotency-Key` (one per user intent, reused on retries).
 */
export function makeActionHandler(deps: ActionHandlerDeps) {
  const persistenceStore = new DynamoDBPersistenceLayer({
    tableName: deps.idempotency.tableName,
    awsSdkV3Client: deps.idempotency.client,
  });
  const config = new IdempotencyConfig({
    // Scoped to the path so a key can never replay a response for another worker.
    eventKeyJmesPath: `[headers."${IDEMPOTENCY_HEADER}", rawPath]`,
    // Reusing a key with a different body is a client bug, not a retry.
    payloadValidationJmesPath: 'body',
    expiresAfterSeconds: 3600,
    throwOnNoIdempotencyKey: true,
  });

  const run = makeIdempotent(
    async (event: HttpEvent, _context: Context): Promise<HttpResult> => {
      const p = parse(event);
      if (!p.ok) return p.result; // unreachable: validated before the idempotent section
      const outcome = await deps.store.applyAction(p.shiftId, p.workerId, p.request.action, {
        expectedVersion: p.request.expectedVersion,
        now: deps.now,
      });
      return toHttp(outcome);
    },
    { persistenceStore, config },
  );

  return withErrors(async (event: HttpEvent, context?: Context) => {
    const key = event.headers?.[IDEMPOTENCY_HEADER];
    if (!key || !KEY_PATTERN.test(key)) {
      return error(422, 'VALIDATION_FAILED', 'An Idempotency-Key header (8–128 letters, digits, - or _) is required.');
    }
    const p = parse(event);
    if (!p.ok) return p.result; // bad input is answered without recording the key

    try {
      return await run(event, context ?? LOCAL_CONTEXT);
    } catch (err) {
      if (err instanceof BusyError) {
        return error(503, 'BUSY', 'The shift is busy right now. Please try again.');
      }
      if (err instanceof IdempotencyAlreadyInProgressError) {
        return error(409, 'REQUEST_IN_PROGRESS', 'This request is already being processed. Please wait a moment.');
      }
      if (err instanceof IdempotencyValidationError) {
        return error(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
      }
      throw err;
    }
  });
}
