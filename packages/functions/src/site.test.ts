import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { error, json, type HttpEvent } from './http';
import { makeSiteHandler, securityHeaders } from './site';

let handler: ReturnType<typeof makeSiteHandler>;
beforeAll(() => {
  const outside = mkdtempSync(join(tmpdir(), 'site-'));
  // A compressed sibling just outside the site folder: no request may reach it.
  writeFileSync(join(outside, 'secret.js'), 'secret');
  writeFileSync(join(outside, 'secret.js.br'), 'secret-br');
  const root = join(outside, 'site');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'favicon.svg'), '<svg/>');
  writeFileSync(join(root, 'assets', 'shift-winter-gala-abc123.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  // #88: the build writes .br and .gz siblings for text assets (marked here to tell them apart).
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'raw-js');
  writeFileSync(join(root, 'assets', 'app-abc123.js.br'), 'br-js');
  writeFileSync(join(root, 'assets', 'app-abc123.js.gz'), 'gz-js');
  writeFileSync(join(root, 'assets', 'only-gz-abc123.css'), 'raw-css');
  writeFileSync(join(root, 'assets', 'only-gz-abc123.css.gz'), 'gz-css');
  handler = makeSiteHandler(root, { eventsHosts: { http: HTTP_HOST, realtime: REALTIME_HOST } });
});

const HTTP_HOST = 'abc.appsync-api.ca-central-1.amazonaws.com';
const REALTIME_HOST = 'abc.appsync-realtime-api.ca-central-1.amazonaws.com';

const get = (rawPath: string, method = 'GET', acceptEncoding?: string) =>
  handler({
    rawPath,
    requestContext: { http: { method } },
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  } as unknown as HttpEvent);
const getEncoded = (rawPath: string, acceptEncoding: string) => get(rawPath, 'GET', acceptEncoding);
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
    const r = await get('/assets/shift-winter-gala-abc123.webp');
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

describe('#88 pre-compressed assets', () => {
  const JS = '/assets/app-abc123.js';
  const CSS = '/assets/only-gz-abc123.css';

  it('serves Brotli when the browser accepts it, with the original type and cache headers', async () => {
    const r = await getEncoded(JS, 'gzip, deflate, br, zstd');
    expect(r.statusCode).toBe(200);
    expect(text(r)).toBe('br-js');
    expect(r.isBase64Encoded).toBe(true);
    expect(r.headers).toMatchObject({
      'content-encoding': 'br',
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      vary: 'Accept-Encoding',
    });
  });

  it('serves gzip when only gzip is accepted', async () => {
    const r = await getEncoded(JS, 'gzip');
    expect(text(r)).toBe('gz-js');
    expect(r.headers?.['content-encoding']).toBe('gzip');
  });

  it('honours q-values: an encoding refused with q=0 is never sent', async () => {
    expect(text(await getEncoded(JS, 'br;q=0, gzip;q=0.8'))).toBe('gz-js');
    expect(text(await getEncoded(JS, 'BR;Q=0.5, GZIP;Q=1'))).toBe('gz-js'); // the client's preference
    expect(text(await getEncoded(JS, 'gzip;q=0.9, br;q=0.9'))).toBe('br-js'); // a tie: smallest wins
    expect(text(await getEncoded(JS, '*'))).toBe('br-js');
    expect(text(await getEncoded(JS, 'br;q=0, gzip;q=0, *'))).toBe('raw-js');
    expect(text(await getEncoded(JS, 'identity'))).toBe('raw-js');
  });

  it('serves the raw file, still with Vary, when no encoding is accepted', async () => {
    const r = await get(JS);
    expect(text(r)).toBe('raw-js');
    expect(r.headers?.['content-encoding']).toBeUndefined();
    expect(r.headers?.vary).toBe('Accept-Encoding');
  });

  it('falls back when a sibling is missing: gzip if it exists, else the raw file', async () => {
    const css = await getEncoded(CSS, 'br, gzip');
    expect(text(css)).toBe('gz-css');
    expect(css.headers).toMatchObject({
      'content-encoding': 'gzip',
      'content-type': 'text/css; charset=utf-8',
    });

    const plain = await getEncoded(CSS, 'br');
    expect(text(plain)).toBe('raw-css');
    expect(plain.headers?.['content-encoding']).toBeUndefined();

    const shell = await getEncoded('/manager', 'br, gzip');
    expect(text(shell)).toContain('<title>app</title>');
    expect(shell.headers?.['content-encoding']).toBeUndefined();
  });

  it('never reads a compressed sibling outside the site folder', async () => {
    for (const p of ['/../secret.js', '/%2e%2e/secret.js', '/assets/../../secret.js']) {
      expect((await getEncoded(p, 'br, gzip')).statusCode, p).toBe(404);
    }
  });
});

describe('#75 security headers', () => {
  const paths = [
    '/',
    '/manager',
    '/worker',
    '/assets/index-abc123.js',
    '/favicon.svg',
    '/assets/missing.js',
    '/api/nope',
  ];

  it('sends the full header set on every page, asset and error response', async () => {
    for (const p of paths) {
      const h = (await get(p)).headers ?? {};
      expect(h['content-security-policy'], p).toBeDefined();
      expect(h['strict-transport-security'], p).toBe('max-age=31536000; includeSubDomains');
      expect(h['referrer-policy'], p).toBe('no-referrer');
      expect(h['permissions-policy'], p).toBe('camera=(), microphone=(), geolocation=()');
      expect(h['x-content-type-options'], p).toBe('nosniff');
    }
  });

  it("has a strict CSP that allows only this origin and this deployment's AppSync hosts", async () => {
    const csp = String((await get('/manager')).headers?.['content-security-policy']);
    const directives = Object.fromEntries(
      csp.split(';').map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(directives).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self' data:",
      'connect-src': `'self' https://${HTTP_HOST} wss://${REALTIME_HOST}`,
      'frame-ancestors': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
    });
    expect(csp).not.toContain('unsafe');
  });

  it("allows only 'self' to connect when no AppSync hosts are configured", () => {
    expect(securityHeaders()['content-security-policy']).toContain("connect-src 'self';");
  });
});

describe('#75 JSON responses', () => {
  it('every JSON response sends nosniff', () => {
    for (const r of [json(200, {}), error(404, 'NOT_FOUND', 'x'), error(500, 'INTERNAL', 'x')]) {
      expect(r.headers?.['x-content-type-options']).toBe('nosniff');
    }
  });
});
