import type { Snapshot, Worker } from '@staffing/domain';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { fetchEvents, fetchSnapshot, SHIFT_ID } from './api';
import {
  createShiftSync,
  type ShiftSync,
  type SyncState,
  type SyncStatus,
  type Transport,
} from './sync/shiftSync';
import { snapshotKey } from './useSnapshot';

/** `off` means this build has no live channel configured (actions refetch instead). */
export type LiveStatus = SyncStatus | 'off';

export type Live = {
  /** True when a live channel is configured. */
  enabled: boolean;
  status: LiveStatus;
  latencyMs: number | null;
  /** Whether actions may be sent now. */
  canAct: boolean;
  outage: boolean;
  setOutage(on: boolean): void;
  /** Feed a committed change from an action response into the live state. */
  ingest(seq: number, row: Worker): void;
};

const OFF: SyncState = { status: 'connecting', latencyMs: null };
const noopSubscribe = () => () => {};

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * Runs the framework-free shift sync for one shift and writes every snapshot it
 * produces into the TanStack Query cache, so components keep reading `useSnapshot`.
 * Snapshots fetched by the query itself are handed to the sync as well.
 */
export function useShiftSync(
  transport: Transport | null,
  shiftId: string,
  online: boolean,
  blocked: boolean,
) {
  const queryClient = useQueryClient();
  const [sync, setSync] = useState<ShiftSync | null>(null);

  useEffect(() => {
    if (!transport) return;
    const key = snapshotKey(shiftId);
    const s = createShiftSync({
      shiftId,
      transport,
      api: { fetchEvents, fetchSnapshot: (id) => fetchSnapshot(id) },
      onSnapshot: (snap) => queryClient.setQueryData(key, snap),
      online: navigator.onLine,
    });
    const offer = (data: unknown) => {
      if (data) s.adoptSnapshot(data as Snapshot);
    };
    offer(queryClient.getQueryData(key));
    const unsubscribe = queryClient.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'success' && e.query.queryHash === JSON.stringify(key)) {
        offer(e.query.state.data);
      }
    });
    s.start();
    setSync(s);
    return () => {
      unsubscribe();
      s.stop();
      setSync(null);
    };
  }, [transport, shiftId, queryClient]);

  useEffect(() => sync?.setOnline(online), [sync, online]);
  useEffect(() => sync?.setBlocked(blocked), [sync, blocked]);

  const state = useSyncExternalStore(sync ? sync.subscribe : noopSubscribe, sync ? sync.getState : () => OFF);
  return { sync, state };
}

const LiveContext = createContext<Live>({
  enabled: false,
  status: 'off',
  latencyMs: null,
  canAct: true,
  outage: false,
  setOutage: () => {},
  ingest: () => {},
});

export function LiveProvider({
  transport,
  shiftId = SHIFT_ID,
  children,
}: {
  transport: Transport | null;
  shiftId?: string;
  children: ReactNode;
}) {
  const online = useOnline();
  const [outage, setOutage] = useState(false);
  const { sync, state } = useShiftSync(transport, shiftId, online, outage);
  const ingest = useCallback((seq: number, row: Worker) => sync?.ingest(seq, row), [sync]);

  const value = useMemo<Live>(() => {
    if (!transport) {
      return {
        enabled: false,
        status: online ? 'off' : 'offline',
        latencyMs: null,
        canAct: online,
        outage,
        setOutage,
        ingest,
      };
    }
    return {
      enabled: true,
      status: state.status,
      latencyMs: state.latencyMs,
      canAct: state.status === 'live',
      outage,
      setOutage,
      ingest,
    };
  }, [transport, online, state, outage, ingest]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
