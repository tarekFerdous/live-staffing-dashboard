/**
 * Init duration of every function on the deployed stage (#94): each one is forced cold, invoked
 * directly, and the `Init Duration` of its REPORT line is read from the returned log tail.
 *
 *   pnpm cold-starts --label before        writes results/cold-starts-before.json
 *   options: --runs 3 (cold invocations per function; the table shows their median)
 *
 * Invoking DemoReset resets the stage's demo shift, as `pnpm reset` would.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { forceColdStarts, invokeWithLog, stackOutput } from '../lib/aws';

const { values: args } = parseArgs({
  options: { label: { type: 'string', default: 'latest' }, runs: { type: 'string', default: '3' } },
});
const RUNS = Number(args.runs);

const shiftId = await stackOutput('ShiftId');
const http = (method: string, rawPath: string, extra: Record<string, unknown> = {}) => ({
  version: '2.0',
  rawPath,
  headers: {},
  requestContext: { http: { method } },
  ...extra,
});

/** Each function with a harmless request that runs its handler (no data is changed but the reset). */
const FUNCTIONS: Record<string, unknown> = {
  Site: http('GET', '/manager'),
  GetConfig: http('GET', '/api/config'),
  GetShift: http('GET', `/api/shifts/${shiftId}`, { pathParameters: { shiftId } }),
  GetEvents: http('GET', `/api/shifts/${shiftId}/events`, {
    pathParameters: { shiftId },
    queryStringParameters: { after: '0' },
  }),
  // An action the domain refuses (a check-out before any check-in): runs the full path, writes nothing.
  PostAction: http('POST', `/api/shifts/${shiftId}/workers/amara/actions`, {
    pathParameters: { shiftId, workerId: 'amara' },
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ action: 'check_out' }),
  }),
  DemoReset: http('POST', '/api/demo/reset'),
  Publisher: { Records: [] },
};

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!;

const results: Record<string, { initMs: number[]; durationMs: number[]; memoryMb: number; median: number }> =
  {};
for (const [name, payload] of Object.entries(FUNCTIONS)) {
  const initMs: number[] = [];
  const durationMs: number[] = [];
  let memoryMb = 0;
  for (let i = 0; i < RUNS; i++) {
    await forceColdStarts([name]);
    if (name === 'PostAction') {
      (payload as { headers: Record<string, string> }).headers['idempotency-key'] = crypto.randomUUID();
    }
    const report = await invokeWithLog(name, payload);
    if (report.initMs === null) throw new Error(`${name}: the invocation was not a cold start`);
    initMs.push(report.initMs);
    durationMs.push(report.durationMs);
    memoryMb = Math.max(memoryMb, report.maxMemoryMb);
  }
  results[name] = { initMs, durationMs, memoryMb, median: median(initMs) };
  console.log(
    `${name.padEnd(10)} init ${String(median(initMs)).padStart(4)} ms (${initMs.join(', ')}), ` +
      `handler ${median(durationMs)} ms, ${memoryMb} MB used`,
  );
}

const dir = new URL('../results/', import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`cold-starts-${args.label}.json`, dir);
writeFileSync(
  file,
  `${JSON.stringify({ measuredAt: new Date().toISOString(), runs: RUNS, functions: results }, null, 2)}\n`,
);
console.log(`Wrote ${fileURLToPath(file)}`);
