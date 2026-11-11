// Live-update smoke test, the same for both modes:
//   pnpm smoke:local                              local mode (docker compose), http://localhost:5173
//   pnpm --filter @staffing/infra smoke:live      the deployed stage (SiteUrl from cdk-outputs.json; CI after deploy)
// Reads GET /api/config like the page does, subscribes to the shift channel with the browser's
// own transport, performs one action through the public API, and waits for that change on the socket.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appSyncTransport, loadRealtimeConfig } from '../../web/src/lib/sync/appsyncTransport';
import { APP_STACK_NAME } from '../lib/config';

const TIMEOUT_MS = 20_000;
const SHIFT_ID = process.env.SHIFT_ID ?? 'harbourfront-gala';

type Worker = { id: string; name: string; participation: string; attendance: string; version: number };

function baseUrlFromArgs(): string | undefined {
  const i = process.argv.indexOf('--base-url');
  return i >= 0 ? process.argv[i + 1] : process.env.BASE_URL;
}

function siteUrlFromOutputs(): string {
  const outputs = JSON.parse(readFileSync(join(import.meta.dirname, '../cdk-outputs.json'), 'utf8'))[
    APP_STACK_NAME
  ] as Record<string, string> | undefined;
  if (!outputs?.SiteUrl)
    throw new Error('cdk-outputs.json has no SiteUrl. Deploy first, or pass --base-url.');
  return outputs.SiteUrl;
}

const siteUrl = (baseUrlFromArgs() ?? siteUrlFromOutputs()).replace(/\/$/, '');
const shiftId = SHIFT_ID;
console.log(`Smoke test against ${siteUrl}`);

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

const realtime = await loadRealtimeConfig(
  ((input: string, init?: RequestInit) => fetch(new URL(input, siteUrl), init)) as typeof fetch,
  `${siteUrl}/`,
);
if (!realtime) {
  console.error(`${siteUrl}/api/config has no realtime endpoint`);
  process.exit(1);
}
console.log(`Live channel: ${realtime.url}`);
const transport = appSyncTransport(realtime);
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

  /** One action through the public API; resolves once its event arrives on the subscription. */
  async function actAndReceive(): Promise<void> {
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
  }

  try {
    await actAndReceive();
  } catch (err) {
    // Right after the stack is first created, the stream's event source mapping can still be
    // starting; it reads from LATEST, so a change made in that window is never published.
    // One more action tells that apart from a broken path.
    console.warn(
      `${err instanceof Error ? err.message : err}. Retrying once (the stream mapping may still be starting).`,
    );
    await actAndReceive();
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  conn.close();
}
