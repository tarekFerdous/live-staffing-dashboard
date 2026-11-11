import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** Loading, error-with-retry, or the loaded content. */
export function QueryState<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <p className="text-slate-500">Loading shift…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">
        <p className="font-medium">Couldn't load the shift.</p>
        <p className="mt-1 text-sm">{query.error.message}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="mt-3 rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-60"
        >
          {query.isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
