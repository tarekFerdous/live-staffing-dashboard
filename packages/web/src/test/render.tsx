import type { Snapshot, Worker } from '@staffing/domain';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App, ROUTER_FUTURE } from '../App';
import type { Transport } from '../lib/sync/shiftSync';

export function renderApp(path: string, opts: { transport?: Transport } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <App queryClient={queryClient} transport={opts.transport ?? null} />
    </MemoryRouter>,
  );
}

const worker = (id: string, name: string, extra: Partial<Worker> = {}): Worker => ({
  id,
  name,
  participation: 'uninvited',
  attendance: 'not_started',
  invitedAt: null,
  respondedAt: null,
  checkedInAt: null,
  checkedOutAt: null,
  version: 0,
  ...extra,
});

export function makeSnapshot(workers?: Worker[], shift: Partial<Snapshot['shift']> = {}): Snapshot {
  return {
    shift: {
      id: 'harbourfront-gala',
      title: 'Winter Gala — Bar & Floor Staff',
      location: 'Harbourfront Centre',
      startsAt: '2026-12-12T22:00:00.000Z',
      endsAt: '2026-12-13T04:00:00.000Z',
      timezone: 'America/Toronto',
      required: 3,
      acceptedCount: 0,
      ...shift,
    },
    workers: workers ?? [
      worker('amara', 'Amara Okafor'),
      worker('liam', 'Liam Chen'),
      worker('sofia', 'Sofia Rossi'),
    ],
    seq: 0,
    epoch: 1,
  };
}

export { worker };

/** A worker's card on the manager page: a region named by the worker's name. */
export const workerCard = (name: string) => screen.getByRole('region', { name });
export const findWorkerCard = (name: string) => screen.findByRole('region', { name });
/** The card's tracker text, e.g. "Step 2 of 4: Accepted" or "Not invited". */
export const trackerOf = (name: string) => within(workerCard(name)).getByTestId('tracker');
/** The value shown next to a label in a card's details (`<dt>label</dt><dd>value</dd>`). */
export const detail = (scope: HTMLElement, label: string) =>
  within(scope).getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Stubs fetch with a queue of responses (or errors); the last one repeats. */
export function stubFetch(...outcomes: (Response | Error)[]) {
  const fn = vi.fn(async () => {
    const next = outcomes.length > 1 ? outcomes.shift()! : outcomes[0]!;
    if (next instanceof Error) throw next;
    return next.clone();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
