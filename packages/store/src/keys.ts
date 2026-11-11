export const shiftPk = (shiftId: string) => `SHIFT#${shiftId}`;
export const META_SK = 'META';
export const workerSk = (workerId: string) => `WORKER#${workerId}`;
export const EVT_PREFIX = 'EVT#';
export const evtSk = (seq: number) => `${EVT_PREFIX}${String(seq).padStart(12, '0')}`;

/**
 * Sort keys in a shift partition order as `EVT#…` < `META` < `WORKER#…`, so the
 * snapshot (META + workers) is exactly `SK >= "META"` and never touches the log.
 */
export const SNAPSHOT_SK_FROM = META_SK;
