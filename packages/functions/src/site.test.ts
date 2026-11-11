import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HttpEvent } from './http';
import { makeSiteHandler } from './site';

let handler: ReturnType<typeof makeSiteHandler>;
beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'site-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  writeFileSync(join(root, 'assets', 'shift-restaurant-abc123.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  handler = makeSiteHandler(root);
});

const get = (rawPath: string, method = 'GET') =>
  handler({ rawPath, requestContext: { http: { method } } } as unknown as HttpEvent);
const text = (r: { body: string }) => Buffer.from(r.body, 'base64').toString('utf8');

describe('site handler', () => {
  it('serves the app shell for client routes, revalidated on every load', async () => {
    for (const p of ['/', '/manager', '/worker']) {
      const r = await get(p);
      expect(r.statusCode).toBe(200);
      expect(r.headers?.['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers?.['cache-control']).toBe('no-cache');
      expect(text(r)).toContain('<title>app</title>');
    }
  });

  it('serves fingerprinted assets with a long cache and the right type', async () => {
    const r = await get('/assets/index-abc123.js');
    expect(r.statusCode).toBe(200);
    expect(r.isBase64Encoded).toBe(true);
    expect(r.headers?.['content-type']).toBe('text/javascript; charset=utf-8');
    expect(r.headers?.['cache-control']).toContain('immutable');
    expect(text(r)).toBe('console.log(1)');
    expect((await get('/favicon.svg')).headers?.['cache-control']).toBe('no-cache');
  });

  it('serves the Shift card photo as image/webp, byte for byte', async () => {
    const r = await get('/assets/shift-restaurant-abc123.webp');
    expect(r.statusCode).toBe(200);
    expect(r.headers?.['content-type']).toBe('image/webp');
    expect([...Buffer.from(r.body, 'base64')]).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it('answers 404 for missing files and unknown API paths, never the page', async () => {
    expect((await get('/assets/missing.js')).statusCode).toBe(404);
    const api = await get('/api/nope');
    expect(api.statusCode).toBe(404);
    expect(JSON.parse(api.body).code).toBe('NOT_FOUND');
  });

  it('never reads outside the site folder', async () => {
    for (const p of ['/../package.json', '/%2e%2e/%2e%2e/etc/passwd.txt', '/assets/../../x.js']) {
      expect((await get(p)).statusCode, p).toBe(404);
    }
  });

  it('refuses writes', async () => {
    expect((await get('/manager', 'POST')).statusCode).toBe(405);
  });
});
