import { createHash, createHmac, type Hash, type Hmac } from 'node:crypto';
import { SignatureV4 } from '@smithy/signature-v4';

export type Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/** Publishes event strings to one AppSync Events channel. */
export type Publish = (channel: string, events: string[]) => Promise<void>;

type SourceData = string | ArrayBuffer | ArrayBufferView;
const toBuffer = (d: SourceData) =>
  typeof d === 'string'
    ? Buffer.from(d, 'utf8')
    : ArrayBuffer.isView(d)
      ? Buffer.from(d.buffer, d.byteOffset, d.byteLength)
      : Buffer.from(d);

/** SHA-256 / HMAC-SHA-256 from node:crypto in the shape SignatureV4 expects. */
class NodeSha256 {
  private h!: Hash | Hmac;
  constructor(private readonly secret?: SourceData) {
    this.reset();
  }
  update(data: SourceData) {
    this.h.update(toBuffer(data));
  }
  async digest() {
    return new Uint8Array(this.h.digest());
  }
  reset() {
    this.h = this.secret ? createHmac('sha256', toBuffer(this.secret)) : createHash('sha256');
  }
}

/** Lambda puts the execution role's short-lived credentials in the environment. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = env;
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) throw new Error('AWS credentials are not set');
  return {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    sessionToken: AWS_SESSION_TOKEN,
  };
}

/**
 * Publishes over the AppSync Events HTTP endpoint (`POST https://<host>/event`),
 * signed with SigV4 for the `appsync` service: publishing is IAM-only.
 */
export function createAppSyncPublisher(opts: {
  httpHost: string;
  region: string;
  credentials?: () => Credentials | Promise<Credentials>;
  fetchFn?: typeof fetch;
}): Publish {
  const signer = new SignatureV4({
    service: 'appsync',
    region: opts.region,
    // Read per request: Lambda refreshes the role credentials in the environment.
    credentials: async () => (opts.credentials ? opts.credentials() : credentialsFromEnv()),
    sha256: NodeSha256,
  });
  const fetchFn = opts.fetchFn ?? fetch;

  return async (channel, events) => {
    const body = JSON.stringify({ channel, events });
    const signed = await signer.sign({
      method: 'POST',
      protocol: 'https:',
      hostname: opts.httpHost,
      path: '/event',
      headers: { host: opts.httpHost, 'content-type': 'application/json' },
      body,
    });
    // fetch sets Host itself (it is a forbidden header); the signature covers the same value.
    const { host: _host, ...headers } = signed.headers;
    void _host;
    const res = await fetchFn(`https://${opts.httpHost}/event`, { method: 'POST', headers, body });
    const text = await res.text();
    if (!res.ok) throw new Error(`AppSync publish to ${channel} failed: ${res.status} ${text}`);
    const result = JSON.parse(text || '{}') as { failed?: unknown[] };
    if (result.failed?.length) {
      throw new Error(
        `AppSync rejected ${result.failed.length} event(s) on ${channel}: ${JSON.stringify(result.failed)}`,
      );
    }
  };
}
