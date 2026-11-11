import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { ManagerPage } from './pages/ManagerPage';
import { WorkerPage } from './pages/WorkerPage';

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });
}

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'}`;

function Layout() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav aria-label="Main" className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
          <span className="mr-auto font-semibold">Live Staffing</span>
          <NavLink to="/manager" className={link}>Manager</NavLink>
          <NavLink to="/worker" className={link}>Worker</NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/manager" element={<ManagerPage />} />
          <Route path="/worker" element={<WorkerPage />} />
          <Route path="*" element={<Navigate to="/manager" replace />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
