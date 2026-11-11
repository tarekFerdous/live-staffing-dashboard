// Deployed smoke test for live updates (run by CI after deploy: `pnpm --filter @staffing/infra smoke:live`).
// Subscribes to the shift channel with the browser's own transport and API key, performs
// one action through the public API, and waits for that change to arrive on the socket.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appSyncTransport } from '../../web/src/lib/sync/appsyncTransport';
import { APP_STACK_NAME } from '../lib/config';

const TIMEOUT_MS = 20_000;

type Outputs = Record<string, string>;
type Worker = { id: string; name: string; participation: string; attendance: string; version: number };

const outputs: Outputs = JSON.parse(readFileSync(join(import.meta.dirname, '../cdk-outputs.json'), 'utf8'))[
  APP_STACK_NAME
];
const need = (k: string) => {
  const v = outputs[k];
  if (!v) throw new Error(`cdk-outputs.json has no ${k}`);
  return v;
};
const siteUrl = need('SiteUrl');
const shiftId = need('ShiftId');

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS} ms: ${what}`)), TIMEOUT_MS).unref(),
    ),
  ]);
}

/** An action that is always legal for some worker and keeps the demo usable: invite ↔ decline. */
function pickAction(workers: Worker[]): { worker: Worker; action: 'invite' | 'decline' } {
  const invitable = workers.find(
    (w) =>
      (w.participation === 'uninvited' || w.participation === 'declined') && w.attendance === 'not_started',
  );
  if (invitable) return { worker: invitable, action: 'invite' };
  const invited = workers.find((w) => w.participation === 'invited');
  if (invited) return { worker: invited, action: 'decline' };
  throw new Error('No worker can be invited or decline; reset the shift (`pnpm reset`) and re-run.');
}

const received: { seq: number; at: string }[] = [];
let onEvent: (() => void) | undefined;
let subscribed!: () => void;
let failed!: (err: Error) => void;
const ready = new Promise<void>((resolve, reject) => {
  subscribed = resolve;
  failed = reject;
});

const transport = appSyncTransport({
  httpHost: need('EventsHttpHost'),
  realtimeHost: need('EventsRealtimeHost'),
  apiKey: need('EventsApiKey'),
});
const channel = `/shifts/${shiftId}`;
const conn = transport.connect(channel, {
  onSubscribed: () => subscribed(),
  onMessage: (data) => {
    received.push(data as { seq: number; at: string });
    onEvent?.();
  },
  onClose: (reason) => failed(new Error(`Connection closed: ${reason}`)),
});

try {
  await withTimeout(ready, `subscribe to ${channel}`);
  console.log(`Subscribed to ${channel}`);

  const snapRes = await fetch(`${siteUrl}/api/shifts/${shiftId}`);
  if (!snapRes.ok) throw new Error(`GET snapshot → ${snapRes.status}`);
  const { workers } = (await snapRes.json()) as { workers: Worker[] };
  const { worker, action } = pickAction(workers);

  const started = Date.now();
  const res = await fetch(`${siteUrl}/api/shifts/${shiftId}/workers/${worker.id}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `smoke-${crypto.randomUUID()}` },
    body: JSON.stringify({ action, expectedVersion: worker.version }),
  });
  const body = (await res.json()) as { seq?: number };
  if (!res.ok || !body.seq)
    throw new Error(`POST ${action} for ${worker.id} → ${res.status} ${JSON.stringify(body)}`);
  console.log(`${action} ${worker.name} committed as seq ${body.seq}`);

  await withTimeout(
    new Promise<void>((resolve) => {
      const check = () => {
        if (received.some((e) => e.seq === body.seq)) resolve();
      };
      onEvent = check;
      check();
    }),
    `event seq ${body.seq} on ${channel}`,
  );
  console.log(
    `Received seq ${body.seq} on the subscription ${Date.now() - started} ms after the request started`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  conn.close();
}
