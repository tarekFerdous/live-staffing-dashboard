import { applyAction, type Action, type Snapshot, type Worker } from '@staffing/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useToast } from '../components/Toast';
import { ApiError, newIdempotencyKey, postAction, SHIFT_ID } from './api';
import { useLive } from './live';
import { sameRow, withWorkerRow } from './optimistic';
import { snapshotKey } from './useSnapshot';

/** `epoch`: the shift's epoch when the user acted, so an answer from before a reset is ignored. */
type Vars = { action: Action; expectedVersion: number; key: string; epoch: number | undefined };
/** What onMutate predicted, so a refusal can undo exactly that. */
type Context = { predicted: Worker; previous: Worker } | undefined;

/** Network failures and a busy shift are worth retrying; refusals (4xx) are final. */
const retryable = (err: unknown) => err instanceof ApiError && (err.status === null || err.status === 503);

/**
 * Runs actions for one worker. Each call to `run` is one user intent with its own
 * Idempotency-Key; TanStack's automatic retries reuse the same variables, so a
 * retry after a lost response can never apply the action twice.
 *
 * With `optimistic` (the worker's own page only), the expected row is shown at once,
 * predicted with the same domain rules the server uses. A refusal puts the previous row
 * back and shows the server's message; success replaces the prediction with the server's
 * row; the live event for the same seq is then a duplicate the sync ignores. The manager
 * page stays non-optimistic, so what it shows is always committed (and its latency honest).
 */
export function useWorkerAction(
  worker: Worker,
  { optimistic = false, shiftId = SHIFT_ID }: { optimistic?: boolean; shiftId?: string } = {},
) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const live = useLive();
  const key = snapshotKey(shiftId);
  // Disabling the button needs a re-render; this blocks a second click that lands before it.
  const inFlight = useRef(false);

  /** Writes `row` unless the cache already holds a newer version of this worker. */
  const showRow = (row: Worker, onlyIfShowing?: Worker) =>
    queryClient.setQueryData<Snapshot>(key, (snap) => {
      const current = snap?.workers.find((w) => w.id === row.id);
      if (!snap || !current) return snap;
      if (onlyIfShowing ? !sameRow(current, onlyIfShowing) : current.version > row.version) return snap;
      return withWorkerRow(snap, row);
    });

  const mutation = useMutation<Awaited<ReturnType<typeof postAction>>, Error, Vars, Context>({
    mutationFn: ({ action, expectedVersion, key: idemKey }: Vars) =>
      postAction(shiftId, worker.id, { action, expectedVersion }, idemKey),
    retry: (failures, err) => failures < 2 && retryable(err),
    retryDelay: (attempt) => 300 * 2 ** attempt,
    onMutate: async ({ action, expectedVersion }) => {
      if (!optimistic) return undefined;
      // A refetch landing after the prediction would briefly undo it.
      await queryClient.cancelQueries({ queryKey: key });
      const snap = queryClient.getQueryData<Snapshot>(key);
      const previous = snap?.workers.find((w) => w.id === worker.id);
      if (!snap || !previous) return undefined;
      const r = applyAction(previous, action, {
        now: new Date().toISOString(),
        acceptedCount: snap.shift.acceptedCount,
        required: snap.shift.required,
        expectedVersion,
      });
      // Only predict what the rules allow; anything else is the server's to explain.
      if (r.kind !== 'applied') return undefined;
      live.pending.set(worker.id, { row: r.worker, baseVersion: previous.version });
      queryClient.setQueryData<Snapshot>(key, withWorkerRow(snap, r.worker));
      return { predicted: r.worker, previous };
    },
    onSuccess: (res, vars) => {
      live.pending.delete(worker.id);
      // The shift was reset while this was in flight: the answer describes the old shift.
      if (queryClient.getQueryData<Snapshot>(key)?.epoch !== vars.epoch) return;
      // The response carries the committed row: show it now rather than waiting for its push.
      showRow(res.worker);
      if (live.enabled && res.seq) live.ingest(res.seq, res.worker);
    },
    onError: (err, vars, ctx) => {
      live.pending.delete(worker.id);
      // Dropped by a reset while in flight: nothing to undo and nothing to explain.
      if (queryClient.getQueryData<Snapshot>(key)?.epoch !== vars.epoch) return;
      // Put the previous row back, unless a live change already replaced the prediction.
      if (ctx) showRow(ctx.previous, ctx.predicted);
      toast.show(err.message);
    },
    // Without live updates, refetch after every action; with them, only after a failure
    // (a refusal means this page was behind, and the snapshot is the quickest fix).
    onSettled: async (_res, err) => {
      if (!live.enabled || err) await queryClient.invalidateQueries({ queryKey: key });
      inFlight.current = false;
    },
  });

  return {
    run: (action: Action) => {
      if (inFlight.current) return;
      inFlight.current = true;
      mutation.mutate({
        action,
        expectedVersion: worker.version,
        key: newIdempotencyKey(),
        epoch: queryClient.getQueryData<Snapshot>(key)?.epoch,
      });
    },
    pending: mutation.isPending,
    pendingAction: mutation.isPending ? mutation.variables?.action : undefined,
  };
}
