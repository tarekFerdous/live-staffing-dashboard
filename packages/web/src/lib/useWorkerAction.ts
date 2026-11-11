import type { Action, Worker } from '@staffing/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useToast } from '../components/Toast';
import { ApiError, newIdempotencyKey, postAction, SHIFT_ID } from './api';
import { snapshotKey } from './useSnapshot';

type Vars = { action: Action; expectedVersion: number; key: string };

/** Network failures and a busy shift are worth retrying; refusals (4xx) are final. */
const retryable = (err: unknown) => err instanceof ApiError && (err.status === null || err.status === 503);

/**
 * Runs actions for one worker. Each call to `run` is one user intent with its own
 * Idempotency-Key; TanStack's automatic retries reuse the same variables, so a
 * retry after a lost response can never apply the action twice.
 */
export function useWorkerAction(worker: Worker, shiftId: string = SHIFT_ID) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Disabling the button needs a re-render; this blocks a second click that lands before it.
  const inFlight = useRef(false);

  const mutation = useMutation({
    mutationFn: ({ action, expectedVersion, key }: Vars) =>
      postAction(shiftId, worker.id, { action, expectedVersion }, key),
    retry: (failures, err) => failures < 2 && retryable(err),
    retryDelay: (attempt) => 300 * 2 ** attempt,
    onError: (err) => toast.show(err.message),
    // Refetch until live push arrives in M4.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: snapshotKey(shiftId) });
      inFlight.current = false;
    },
  });

  return {
    run: (action: Action) => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutation.mutate({ action, expectedVersion: worker.version, key: newIdempotencyKey() });
    },
    pending: mutation.isPending,
    pendingAction: mutation.isPending ? mutation.variables?.action : undefined,
  };
}
