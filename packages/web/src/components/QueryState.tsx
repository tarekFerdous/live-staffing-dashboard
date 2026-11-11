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
  if (query.isPending) {
    return (
      <p className="card px-5 py-4 text-muted" aria-busy="true">
        Loading shift…
      </p>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="card p-5">
        <p className="font-medium text-bad-fg">Couldn't load the shift.</p>
        <p className="mt-1 text-sm text-muted">{query.error.message}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="btn btn-primary mt-4"
        >
          {query.isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
