// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import './zodConfig';

describe('zod under the CSP', () => {
  it('runs jitless, so no `new Function` probe trips the strict CSP', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('is configured by the very first import of the entry point, before any schema parses', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const firstImport = main.split('\n').find((line) => line.startsWith('import '));
    expect(firstImport).toMatch(/^import '\.\/lib\/zodConfig';/);
  });
});
