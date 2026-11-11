/**
 * Renders the README's measurement section from results/*.json, so no number is typed by hand.
 * Replaces everything between the `measurements:start` and `measurements:end` markers.
 *
 *   pnpm measure:render
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

type Summary = { n: number; p50: number; p95: number; max: number };
type Stat = { count: number; p50: number; p95: number; max: number } | null;
type Result = {
  target: 'local' | 'stage';
  measuredAt: string;
  durationS: number;
  machine: { os: string; cpu: string; memoryGb: number; node: string; browser: string };
  conditions: string;
  updateDelayMs: Summary;
  recoveryMs: Summary;
  coldStart: { ms: number; note: string } | null;
  perHopMs: Record<string, Stat> | null;
  throttling: { readThrottleEvents: number; writeThrottleEvents: number } | null;
};

const START = '<!-- measurements:start -->';
const END = '<!-- measurements:end -->';
const README = new URL('../../../README.md', import.meta.url);

const load = (target: string): Result | null => {
  const file = new URL(`../results/${target}.json`, import.meta.url);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Result) : null;
};
const ms = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? '—' : `${Math.round(x)} ms`);

const local = load('local');
const stage = load('stage');
if (!local && !stage)
  throw new Error('No results yet: run `pnpm measure` and/or `pnpm measure --stage` first.');

const cols = [local && 'Local (docker compose)', stage && 'Cloud (ca-central-1)'].filter(Boolean) as string[];
const results = [local, stage].filter(Boolean) as Result[];
const row = (label: string, cell: (r: Result) => string) => `| ${label} | ${results.map(cell).join(' | ')} |`;
const sep = `| --- | ${results.map(() => '---:').join(' | ')} |`;

const lines: string[] = [
  START,
  '',
  `| Metric | ${cols.join(' | ')} |`,
  sep,
  row('Update delay p50', (r) => ms(r.updateDelayMs.p50)),
  row('Update delay p95', (r) => ms(r.updateDelayMs.p95)),
  row('Update delay max', (r) => ms(r.updateDelayMs.max)),
  row('Update delay runs', (r) => String(r.updateDelayMs.n)),
  row('Recovery p50', (r) => ms(r.recoveryMs.p50)),
  row('Recovery p95', (r) => ms(r.recoveryMs.p95)),
  row('Recovery max', (r) => ms(r.recoveryMs.max)),
  row('Recovery runs', (r) => String(r.recoveryMs.n)),
  row('Cold start (first action, not in the percentiles)', (r) =>
    r.coldStart ? ms(r.coldStart.ms) : 'n/a (no cold starts locally)',
  ),
  row('DynamoDB throttle events during the run', (r) =>
    r.throttling ? String(r.throttling.readThrottleEvents + r.throttling.writeThrottleEvents) : 'n/a',
  ),
  '',
];

if (stage?.perHopMs) {
  const hop = (name: string, label: string) => {
    const s = stage.perHopMs?.[name];
    return `| ${label} | ${s ? `${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.max)} | ${s.count}` : '— | — | — | 0'} |`;
  };
  lines.push(
    'Cloud path per hop (Powertools metrics read back from CloudWatch for the same run):',
    '',
    '| Hop | p50 | p95 | max | samples |',
    '| --- | ---: | ---: | ---: | ---: |',
    hop('CommandDuration', 'Action Lambda: request in → response out'),
    hop(
      'CommitToPublisher',
      'Event timestamp → publisher starts (DynamoDB write, stream, event source mapping)',
    ),
    hop('PublishDuration', 'Publisher → AppSync Events HTTP publish'),
    '',
    'The rest of the update delay is the browser → API Gateway → Lambda round trip and AppSync fan-out to the',
    "manager's WebSocket and React rendering. The command and commit-to-publisher hops overlap: the event's",
    'timestamp is taken inside the action Lambda.',
    '',
  );
}

for (const r of results) {
  lines.push(
    `- **${r.target === 'local' ? 'Local' : 'Cloud'}**, measured ${r.measuredAt.slice(0, 16).replace('T', ' ')} UTC ` +
      `(${r.durationS} s): ${r.machine.os}, ${r.machine.cpu}, ${r.machine.memoryGb} GB, Node ${r.machine.node}, ` +
      `${r.machine.browser}. ${r.conditions}.`,
  );
}
lines.push('', END);

const readme = readFileSync(README, 'utf8');
const from = readme.indexOf(START);
const to = readme.indexOf(END);
if (from < 0 || to < from) throw new Error(`README.md needs the ${START} … ${END} markers.`);
writeFileSync(README, readme.slice(0, from) + lines.join('\n') + readme.slice(to + END.length));
console.log(`Updated the measurements table in README.md (${cols.join(', ')}).`);
