import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** Loading, error-with-retry, or the loaded content. */
export function QueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <p className="text-muted">Loading shift…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-xl border border-border bg-bad-bg p-4 text-bad-fg">
        <p className="font-medium">Couldn't load the shift.</p>
        <p className="mt-1 text-sm">{query.error.message}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="btn btn-danger mt-3"
        >
          {query.isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
