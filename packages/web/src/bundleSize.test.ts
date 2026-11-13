// @vitest-environment node
// What the production build really ships: what each route downloads (#89) and the pre-compressed
// copies the Site Lambda serves (#88). Runs in CI with the rest of the web tests, so neither can
// quietly regress.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { build, type Rollup } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type OutputChunk = Rollup.OutputChunk;
type RollupOutput = Rollup.RollupOutput;

/**
 * Gzipped JS budget for everything the worker route loads (entry, shared chunks, worker page):
 * 22% below the 118 KB single bundle it replaced. (The PRD's 76 KB was set against the bundle
 * before zod 4 and react-router 7; react-dom, react-router, TanStack Query and zod alone now
 * come to about 75 KB.)
 */
export const WORKER_ROUTE_BUDGET = 92 * 1024;

/** Code only the manager uses. None of it may reach the worker route. */
const MANAGER_ONLY = [
  'src/pages/ManagerPage.tsx',
  'src/components/StaffingChart.tsx',
  'src/components/StaffingCard.tsx',
  'src/components/ActivityTimeline.tsx',
  'src/components/ResetDemo.tsx',
  'src/lib/staffingSeries.ts',
  'src/lib/useTimeline.ts',
];

let chunks: OutputChunk[];
const outDir = mkdtempSync(join(tmpdir(), 'web-build-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

beforeAll(async () => {
  // Vitest sets NODE_ENV=test, which would make Vite bundle React's development build.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let out: RollupOutput | RollupOutput[];
  try {
    out = (await build({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })) as RollupOutput | RollupOutput[];
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
  chunks = (Array.isArray(out) ? out : [out])
    .flatMap((o) => o.output)
    .filter((o): o is OutputChunk => o.type === 'chunk');
}, 60_000);

/** The chunks a page loads: the entry, the page's own chunk, and everything they import statically. */
function route(page: string): OutputChunk[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find((c) => c.isEntry)!;
  const pageChunk = chunks.find((c) => c.facadeModuleId?.replaceAll('\\', '/').endsWith(page));
  expect(pageChunk, `${page} is its own chunk`).toBeDefined();
  const seen = new Set<OutputChunk>();
  const visit = (c: OutputChunk) => {
    if (seen.has(c)) return;
    seen.add(c);
    c.imports.forEach((name) => visit(byName.get(name)!));
  };
  visit(entry);
  visit(pageChunk!);
  return [...seen];
}

const gzipped = (cs: OutputChunk[]) => cs.reduce((n, c) => n + gzipSync(c.code, { level: 9 }).length, 0);
const modulesOf = (cs: OutputChunk[]) =>
  cs.flatMap((c) => Object.keys(c.modules)).map((id) => id.replaceAll('\\', '/'));

describe('route code-splitting (#89)', () => {
  it(`keeps the worker route's gzipped JS within ${WORKER_ROUTE_BUDGET / 1024} KB`, () => {
    const size = gzipped(route('src/pages/WorkerPage.tsx'));
    expect(size, `worker route is ${(size / 1024).toFixed(1)} KB gzipped`).toBeLessThanOrEqual(
      WORKER_ROUTE_BUDGET,
    );
  });

  it('ships none of the manager-only code to the worker route', () => {
    const modules = modulesOf(route('src/pages/WorkerPage.tsx'));
    for (const file of MANAGER_ONLY) expect(modules.filter((id) => id.endsWith(file))).toEqual([]);
  });

  it('loads the manager page in its own chunk, with the chart and the activity rail', () => {
    const modules = modulesOf(route('src/pages/ManagerPage.tsx'));
    for (const file of MANAGER_ONLY.filter((f) => !f.endsWith('ResetDemo.tsx')))
      expect(
        modules.some((id) => id.endsWith(file)),
        file,
      ).toBe(true);
  });

  it('inlines no images into JS', () => {
    expect(chunks.filter((c) => c.code.includes('data:image/'))).toEqual([]);
  });
});

describe('pre-compressed assets (#88)', () => {
  const files = () =>
    (readdirSync(outDir, { recursive: true }) as string[]).map((f) => f.replaceAll('\\', '/'));

  it('writes .br and .gz copies of every text asset over 1 KB, each decoding to the original', () => {
    const all = files();
    const text = all.filter((f) => /\.(js|css|html|svg|json)$/.test(f));
    const big = text.filter((f) => readFileSync(join(outDir, f)).length >= 1024);
    expect(big.filter((f) => f.endsWith('.js')).length).toBeGreaterThan(1);
    for (const f of big) {
      const raw = readFileSync(join(outDir, f));
      const br = readFileSync(join(outDir, `${f}.br`));
      const gz = readFileSync(join(outDir, `${f}.gz`));
      expect(brotliDecompressSync(br).equals(raw), f).toBe(true);
      expect(gunzipSync(gz).equals(raw), f).toBe(true);
      expect(br.length, f).toBeLessThan(gz.length);
    }
    // Tiny files (the shell, theme-init.js) aren't worth the encoding headers.
    for (const f of text.filter((t) => !big.includes(t))) expect(all, f).not.toContain(`${f}.gz`);
  });

  it('leaves images and fonts alone: they are compressed already', () => {
    const binaries = files().filter((f) => /\.(webp|png|jpg|woff2)(\.br|\.gz)?$/.test(f));
    expect(binaries.some((f) => f.endsWith('.woff2'))).toBe(true);
    expect(binaries.filter((f) => /\.(br|gz)$/.test(f))).toEqual([]);
  });
});
