import type { ShiftEventMessage, Snapshot } from '@staffing/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchEvents, SHIFT_ID } from './api';
import { addTimelineEvents, eventsKey, TIMELINE_LIMIT } from './timelineCache';

export { addTimelineEvents, eventsKey, mergeEvents, resetTimeline, TIMELINE_LIMIT } from './timelineCache';

/**
 * The oldest seq the timeline should show but doesn't, or null. Looking for the first hole
 * (not just past the newest entry) matters: a live event can land before an earlier read
 * returns, and the entries in between must still be fetched.
 */
export function firstMissing(events: readonly ShiftEventMessage[], latestSeq: number): number | null {
  const have = new Set(events.map((e) => e.seq));
  for (let s = Math.max(1, latestSeq - TIMELINE_LIMIT + 1); s <= latestSeq; s++) if (!have.has(s)) return s;
  return null;
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
  const gap = query.data ? firstMissing(query.data, snapshot.seq) : null;

  useEffect(() => {
    if (gap === null) return;
    let cancelled = false;
    fetchEvents(shiftId, gap - 1)
      .then((page) => {
        if (!cancelled) addTimelineEvents(qc, shiftId, page.events);
      })
      // The next change tries again; the list itself stays correct, only incomplete.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gap, shiftId, qc]);

  return query;
}
