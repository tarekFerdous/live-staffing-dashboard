// Serves the built web app from the HTTP API's $default route, so page and API share one
// origin (no CORS). A stand-in for CloudFront + S3 while the account can't create CloudFront
// distributions: see todo.md. Specific /api/* routes always win over $default.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { error, type HttpHandler, type HttpResult } from './http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/** Vite fingerprints everything under /assets, so those can be cached for good. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

export type SiteOptions = {
  /** This deployment's AppSync Events hosts (HTTP and realtime), allowed in `connect-src`. */
  eventsHosts?: { http?: string; realtime?: string };
};

/**
 * Sent with every Site response. Same origin plus this stage's own AppSync hosts and nothing else.
 * (CloudFront response-headers policies would carry these once CloudFront is restored.)
 */
export function securityHeaders(opts: SiteOptions = {}): Record<string, string> {
  const { http, realtime } = opts.eventsHosts ?? {};
  const connect = ["'self'", http && `https://${http}`, realtime && `wss://${realtime}`].filter(Boolean);
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    'content-security-policy': csp,
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-content-type-options': 'nosniff',
  };
}

/** Pre-compressed siblings the build writes (#88), best first. */
const ENCODINGS = [
  { name: 'br', suffix: '.br' },
  { name: 'gzip', suffix: '.gz' },
] as const;

/**
 * The encodings this `Accept-Encoding` header allows, best first. Honours q-values: `q=0` refuses
 * an encoding, and `*` stands for any encoding not named.
 */
export function acceptedEncodings(header: string | undefined): (typeof ENCODINGS)[number][] {
  if (!header) return [];
  const q = new Map<string, number>();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const value = qParam ? Number(qParam.slice(2)) : 1;
    q.set(name.trim(), Number.isFinite(value) ? value : 0);
  }
  const weight = (name: string) => q.get(name) ?? q.get('*') ?? 0;
  return ENCODINGS.filter((e) => weight(e.name) > 0).sort((a, b) => weight(b.name) - weight(a.name));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function makeSiteHandler(rootDir: string, opts: SiteOptions = {}): HttpHandler {
  const root = normalize(rootDir);
  const security = securityHeaders(opts);
  const handle = makeHandler(root);
  return async (event, context) => {
    const res = await handle(event, context);
    return { ...res, headers: { ...res.headers, ...security } };
  };
}

function makeHandler(root: string): HttpHandler {
  /**
   * Sends `file`, or its best pre-compressed sibling the browser accepts. The sibling's path is the
   * already-checked file path plus a fixed suffix, so it can't leave the site folder either.
   */
  async function serve(file: string, cacheControl: string, acceptEncoding?: string): Promise<HttpResult> {
    let source = file;
    let encoding: string | undefined;
    for (const e of acceptedEncodings(acceptEncoding)) {
      if (await isFile(file + e.suffix)) {
        source = file + e.suffix;
        encoding = e.name;
        break;
      }
    }
    const body = await readFile(source);
    return {
      statusCode: 200,
      headers: {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': cacheControl,
        ...(encoding && { 'content-encoding': encoding }),
        // Caches must keep each encoding apart, including the raw one.
        vary: 'Accept-Encoding',
      },
      body: body.toString('base64'),
      isBase64Encoded: true,
    };
  }

  return async (event) => {
    const acceptEncoding = event.headers?.['accept-encoding'];
    const method = event.requestContext?.http?.method ?? 'GET';
    let path: string;
    try {
      path = decodeURIComponent(event.rawPath ?? '/');
    } catch {
      return error(400, 'BAD_PATH', 'The address is not valid.');
    }
    // Unknown API paths are API errors, never the page.
    if (path === '/api' || path.startsWith('/api/')) {
      return error(404, 'NOT_FOUND', `No route for ${method} ${path}`);
    }
    if (method !== 'GET' && method !== 'HEAD')
      return error(405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed here.');

    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return error(404, 'NOT_FOUND', 'Not found.');

    if (extname(path)) {
      if (!(await isFile(file))) return error(404, 'NOT_FOUND', 'Not found.');
      return serve(file, path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE, acceptEncoding);
    }
    // Client-side routes (/manager, /worker, /) all load the app shell.
    return serve(join(root, 'index.html'), REVALIDATE, acceptEncoding);
  };
}
