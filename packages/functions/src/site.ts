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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function makeSiteHandler(rootDir: string): HttpHandler {
  const root = normalize(rootDir);

  async function serve(file: string, cacheControl: string): Promise<HttpResult> {
    const body = await readFile(file);
    return {
      statusCode: 200,
      headers: {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': cacheControl,
        'x-content-type-options': 'nosniff',
      },
      body: body.toString('base64'),
      isBase64Encoded: true,
    };
  }

  return async (event) => {
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
      return serve(file, path.startsWith('/assets/') ? IMMUTABLE : REVALIDATE);
    }
    // Client-side routes (/manager, /worker, /) all load the app shell.
    return serve(join(root, 'index.html'), REVALIDATE);
  };
}
