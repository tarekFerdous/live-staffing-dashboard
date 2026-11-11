import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { LivePausedNotice, LiveStatusBar } from './components/LiveStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { ToastProvider } from './components/Toast';
import { LiveProvider } from './lib/live';
import type { Transport } from './lib/sync/shiftSync';
import { ManagerPage } from './pages/ManagerPage';
import { WorkerPage } from './pages/WorkerPage';

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });
}

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-semibold ${isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg'}`;

function Layout() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <a
        href="#main"
        className="sr-only rounded-md bg-accent px-3 py-2 text-accent-fg focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-accent" />
            Live Staffing
          </span>
          <nav aria-label="Main" className="flex gap-1">
            <NavLink to="/manager" className={link}>
              Manager
            </NavLink>
            <NavLink to="/worker" className={link}>
              Worker
            </NavLink>
          </nav>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto">
            <LiveStatusBar />
            <ThemeToggle />
          </div>
        </div>
        <LivePausedNotice />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-6 focus:outline-none">
        <Outlet />
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
