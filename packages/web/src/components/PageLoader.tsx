import { Component, Suspense, type ReactNode } from 'react';

/** Shown for the moment a page's code chunk is on its way. */
export function PageFallback() {
  return (
    <p className="card px-5 py-4 text-muted" aria-busy="true">
      Loading…
    </p>
  );
}

/**
 * Catches a page chunk that fails to load, usually a tab left open across a deploy (its old
 * hashed chunk is gone). A reload fetches the current app.
 */
export class ChunkErrorBoundary extends Component<
  { children: ReactNode; reload?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.reload ?? (() => window.location.reload());
    return (
      <div role="alert" className="card p-5">
        <p className="font-medium text-bad-fg">This page couldn't load.</p>
        <p className="mt-1 text-sm text-muted">The app may have been updated since you opened it.</p>
        <button type="button" onClick={reload} className="btn btn-primary mt-4">
          Reload
        </button>
      </div>
    );
  }
}

/** A lazily loaded page: the loading state while its chunk arrives, a reload prompt if it fails. */
export function PageLoader({ children }: { children: ReactNode }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}
