import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { HttpEvent, HttpHandler } from '../http';

export type Route = { method: string; path: string; handler: HttpHandler };

/** Compiles `/api/shifts/{shiftId}` into a matcher that returns path parameters. */
function compile(path: string) {
  const names: string[] = [];
  const re = new RegExp(
    '^' +
      path.replace(/\{(\w+)\}/g, (_, n: string) => {
        names.push(n);
        return '([^/]+)';
      }) +
      '$',
  );
  return (url: string) => {
    const m = re.exec(url);
    if (!m) return null;
    return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
  };
}

async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
}

/**
 * A tiny Node HTTP server that turns requests into API Gateway HTTP API (v2)
 * events and calls the very same handlers the Lambdas use.
 */
export function createLocalServer(routes: Route[]): Server {
  const compiled = routes.map((r) => ({ ...r, match: compile(r.path) }));
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    let route: (typeof compiled)[number] | undefined;
    let pathParameters: Record<string, string> | null = null;
    for (const r of compiled) {
      if (r.method !== method) continue;
      pathParameters = r.match(url.pathname);
      if (pathParameters) {
        route = r;
        break;
      }
    }
    if (!route || !pathParameters) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'NOT_FOUND', message: `No route for ${method} ${url.pathname}` }));
      return;
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
    );
    const event = {
      version: '2.0',
      routeKey: `${route.method} ${route.path}`,
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams),
      pathParameters,
      body: await readBody(req),
      isBase64Encoded: false,
      requestContext: { http: { method, path: url.pathname } },
    } as unknown as HttpEvent;
    const result = await route.handler(event);
    res.writeHead(result.statusCode, result.headers as Record<string, string>);
    res.end(result.body);
  });
}
