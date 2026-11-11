import type { Snapshot, Worker } from '@staffing/domain';

/** A worker row shown before the server confirmed it, and the version it was predicted from. */
export type PendingRow = { row: Worker; baseVersion: number };

/** Field-by-field equality (the query cache copies objects, so identity can't be used). */
export function sameRow(a: Worker, b: Worker): boolean {
  const keys = Object.keys(a) as (keyof Worker)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** Replaces one worker's row (counts are derived from rows, so nothing else needs to change). */
export function withWorkerRow(snapshot: Snapshot, row: Worker): Snapshot {
  return { ...snapshot, workers: snapshot.workers.map((w) => (w.id === row.id ? row : w)) };
}

/**
 * Puts pending optimistic rows on top of a snapshot from the server, so a live change to
 * someone else does not briefly undo this page's own prediction. A row the server has
 * already moved past (version above the base) is shown as the server has it.
 */
export function overlayPending(snapshot: Snapshot, pending: ReadonlyMap<string, PendingRow>): Snapshot {
  if (pending.size === 0) return snapshot;
  let changed = false;
  const workers = snapshot.workers.map((w) => {
    const p = pending.get(w.id);
    if (!p || w.version > p.baseVersion) return w;
    changed = true;
    return p.row;
  });
  return changed ? { ...snapshot, workers } : snapshot;
}
