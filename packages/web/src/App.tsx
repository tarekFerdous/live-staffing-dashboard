import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { LiveIcon } from './components/icons';
import { LivePausedNotice, LiveStatusBar } from './components/LiveStatus';
import { ResetDemo } from './components/ResetDemo';
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

// Pill navigation: the active page is a black pill (white in dark mode).
const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
    isActive ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-secondary hover:text-fg'
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-5 pb-2">
          <span className="flex items-center gap-2 text-base font-bold tracking-tight">
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
            {onManager && <ResetDemo />}
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
