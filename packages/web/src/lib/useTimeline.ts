import type { ShiftEventMessage, Snapshot } from '@staffing/domain';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchEvents, SHIFT_ID } from './api';

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

/**
 * The shift's recent activity: the last TIMELINE_LIMIT events from the log, then every
 * live or caught-up event the sync reports (see LiveProvider). When the snapshot moves past
 * the newest entry without an event (the page's own action, a refetch, a snapshot fallback
 * after a long outage), the missing entries are read from the log, so nothing is skipped.
 */
export function useTimeline(snapshot: Snapshot, shiftId: string = SHIFT_ID) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: eventsKey(shiftId),
    queryFn: async () => (await fetchEvents(shiftId, Math.max(0, snapshot.seq - TIMELINE_LIMIT))).events,
    staleTime: Infinity,
  });
  const loaded = query.data !== undefined;
  const newest = query.data?.at(-1)?.seq ?? 0;

  useEffect(() => {
    if (!loaded || snapshot.seq <= newest) return;
    let cancelled = false;
    fetchEvents(shiftId, newest)
      .then((page) => {
        if (!cancelled) addTimelineEvents(qc, shiftId, page.events);
      })
      // The next change tries again; the list itself stays correct, only incomplete.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loaded, newest, snapshot.seq, shiftId, qc]);

  return query;
}
