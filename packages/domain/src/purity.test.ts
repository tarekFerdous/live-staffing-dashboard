import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

describe('domain package purity', () => {
  it('has no AWS or React imports in its sources', () => {
    const dir = join(import.meta.dirname);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/from ['"](@aws-sdk|aws-cdk-lib|react)/);
    }
  });

  it('has no AWS or React dependencies', () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /aws|react/i.test(d))).toEqual([]);
  });
});
