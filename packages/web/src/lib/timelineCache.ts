// The timeline's cache entry, which live sync writes on every page. The hook that reads it
// (useTimeline) is the manager's alone, so it stays out of the worker route's code (#89).
import type { ShiftEventMessage } from '@staffing/domain';
import type { QueryClient } from '@tanstack/react-query';

/** Most entries the timeline keeps (and shows). */
export const TIMELINE_LIMIT = 50;

export const eventsKey = (shiftId: string) => ['events', shiftId] as const;

/** Oldest first, one entry per seq, only the newest TIMELINE_LIMIT. */
export function mergeEvents(
  current: readonly ShiftEventMessage[],
  incoming: readonly ShiftEventMessage[],
): ShiftEventMessage[] {
  const bySeq = new Map(current.map((e) => [e.seq, e]));
  for (const e of incoming) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-TIMELINE_LIMIT);
}

/** Adds events to a loaded timeline (pages without a timeline are left alone). */
export function addTimelineEvents(qc: QueryClient, shiftId: string, events: readonly ShiftEventMessage[]) {
  qc.setQueryData<ShiftEventMessage[]>(eventsKey(shiftId), (old) => (old ? mergeEvents(old, events) : old));
}

/** After a reset: the log starts again, so a loaded timeline becomes empty. */
export function resetTimeline(qc: QueryClient, shiftId: string) {
  qc.setQueryData<ShiftEventMessage[]>(eventsKey(shiftId), (old) => (old ? [] : old));
}
