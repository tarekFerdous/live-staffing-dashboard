import { useQuery } from '@tanstack/react-query';
import { fetchSnapshot, SHIFT_ID } from './api';

export const snapshotKey = (shiftId: string) => ['shift', shiftId] as const;

export function useSnapshot(shiftId: string = SHIFT_ID) {
  return useQuery({
    queryKey: snapshotKey(shiftId),
    queryFn: ({ signal }) => fetchSnapshot(shiftId, signal),
  });
}
