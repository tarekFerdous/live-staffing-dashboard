import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';

export type HttpEvent = APIGatewayProxyEventV2;
export type HttpResult = APIGatewayProxyStructuredResultV2 & { statusCode: number; body: string };
export type HttpHandler = (event: HttpEvent, context?: Context) => Promise<HttpResult>;

export function json(statusCode: number, body: unknown): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const error = (statusCode: number, code: string, message: string) => json(statusCode, { code, message });

/** Turns unexpected exceptions into a 500 with a readable message instead of a bare Lambda error. */
export function withErrors(handler: HttpHandler): HttpHandler {
  return async (event, context) => {
    try {
      return await handler(event, context);
    } catch (err) {
      console.error(err);
      return error(500, 'INTERNAL', 'Something went wrong on the server. Please try again.');
    }
  };
}
