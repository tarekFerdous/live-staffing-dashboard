import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lazy, Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary, PageFallback, PageLoader } from './PageLoader';

const quiet = (e: ErrorEvent) => e.preventDefault();
afterEach(() => {
  vi.restoreAllMocks();
  window.removeEventListener('error', quiet);
});

/**
 * A page whose chunk can't be fetched, as after a deploy removed the old hashed file. The error
 * is expected, so React's and jsdom's reports of it are silenced.
 */
const MissingPage = () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', quiet);
  return lazy(() =>
    Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/WorkerPage-old.js')),
  );
};

describe('#89 lazily loaded pages', () => {
  it('shows a small loading state while the page chunk is on its way', async () => {
    let arrive!: (m: { default: () => JSX.Element }) => void;
    const Page = lazy(() => new Promise<{ default: () => JSX.Element }>((r) => (arrive = r)));
    render(
      <PageLoader>
        <Page />
      </PageLoader>,
    );
    expect(screen.getByText('Loading…')).toHaveAttribute('aria-busy', 'true');
    arrive({ default: () => <h1>Worker page</h1> });
    expect(await screen.findByRole('heading', { name: 'Worker page' })).toBeInTheDocument();
  });

  it('offers a reload when the page chunk fails to load', async () => {
    const reload = vi.fn();
    const Page = MissingPage();
    render(
      <ChunkErrorBoundary reload={reload}>
        <Suspense fallback={<PageFallback />}>
          <Page />
        </Suspense>
      </ChunkErrorBoundary>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("This page couldn't load.");
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads the window by default', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const Page = MissingPage();
    render(
      <PageLoader>
        <Page />
      </PageLoader>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
