import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { LiveIcon } from './components/icons';
import { GUTTER, LivePausedNotice, LiveStatusBar } from './components/LiveStatus';
import { lazy, Suspense } from 'react';
import { PageLoader } from './components/PageLoader';
import { ThemeToggle } from './components/ThemeToggle';
import { ToastProvider } from './components/Toast';
import { LiveProvider } from './lib/live';
import type { Transport } from './lib/sync/shiftSync';

// Each page is its own chunk: the worker page never downloads the manager's chart and rail.
const ManagerPage = lazy(() => import('./pages/ManagerPage').then((m) => ({ default: m.ManagerPage })));
const WorkerPage = lazy(() => import('./pages/WorkerPage').then((m) => ({ default: m.WorkerPage })));
// The demo's reset and outage controls are the manager's, so they load with the manager page.
const ResetDemo = lazy(() => import('./components/ResetDemo').then((m) => ({ default: m.ResetDemo })));

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });
}

// Pill navigation: the active page is a black pill (white in dark mode), in Medium.
const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-1.5 text-sm transition-colors ${
    isActive ? 'bg-primary font-medium text-primary-fg' : 'text-muted hover:bg-secondary hover:text-fg'
  }`;

function Layout() {
  const onManager = useLocation().pathname.startsWith('/manager');
  return (
    <div className="min-h-screen text-fg">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header>
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 pt-5 pb-2 ${GUTTER}`}>
          <span className="flex items-center gap-2 text-base font-medium tracking-tight">
            <span className="icon-badge h-7 w-7">
              <LiveIcon size={14} />
            </span>
            Live Staffing
          </span>
          <nav aria-label="Main" className="card flex gap-1 rounded-full p-1">
            <NavLink to="/manager" className={link}>
              Manager
            </NavLink>
            <NavLink to="/worker" className={link}>
              Worker
            </NavLink>
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto">
            <LiveStatusBar />
            {/* Demo controls sit together; resetting is the manager's. */}
            {onManager && (
              <Suspense fallback={null}>
                <ResetDemo />
              </Suspense>
            )}
            <ThemeToggle />
          </div>
        </div>
        <LivePausedNotice />
      </header>
      <main id="main" tabIndex={-1} className={`py-6 focus:outline-none ${GUTTER}`}>
        {/* Keyed by page so a failed chunk on one page doesn't stick when switching to the other. */}
        <PageLoader key={onManager ? 'manager' : 'worker'}>
          <Outlet />
        </PageLoader>
      </main>
    </div>
  );
}

/** `transport` is the live channel; without one the app works by refetching after actions. */
export function App({
  queryClient,
  transport = null,
}: {
  queryClient: QueryClient;
  transport?: Transport | null;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveProvider transport={transport}>
        <ToastProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/manager" element={<ManagerPage />} />
              <Route path="/worker" element={<WorkerPage />} />
              <Route path="*" element={<Navigate to="/manager" replace />} />
            </Route>
          </Routes>
        </ToastProvider>
      </LiveProvider>
    </QueryClientProvider>
  );
}
