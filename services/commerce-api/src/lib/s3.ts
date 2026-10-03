import { createHash, createHmac } from 'node:crypto';

/**
 * Minimal S3 API client (ADR-0007, LR-005): signed PUT/GET/HEAD of a single
 * object with AWS Signature Version 4, path-style or virtual-hosted URLs.
 * Works with AWS S3 and S3-compatible stores (MinIO, R2, Spaces). Objects are
 * written without any ACL, so they stay private to the bucket's policy.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  timeoutMs?: number;
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 requires (keeps '/' between key segments). */
function encodeKey(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

export class S3ObjectStore {
  constructor(private readonly config: S3Config) {}

  private url(key: string): URL {
    const base = new URL(this.config.endpoint);
    if (this.config.forcePathStyle) {
      base.pathname = `${base.pathname.replace(/\/$/, '')}/${this.config.bucket}/${encodeKey(key)}`;
    } else {
      base.hostname = `${this.config.bucket}.${base.hostname}`;
      base.pathname = `${base.pathname.replace(/\/$/, '')}/${encodeKey(key)}`;
    }
    return base;
  }

  /** Signs and sends one request; returns the raw response. */
  async request(method: 'PUT' | 'GET' | 'HEAD' | 'DELETE', key: string, body?: Buffer, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const url = this.url(key);
    const payloadHash = sha256Hex(body ?? '');
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
      ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
    };
    const authorization = signV4({ method, path: url.pathname, query: url.search.slice(1), headers, payloadHash, region: this.config.region, accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey });
    // fetch sets Host itself from the URL (the same value that was signed).
    const sendHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'host'));
    return fetch(url, {
      method,
      headers: { ...sendHeaders, authorization },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.request('PUT', key, body, { 'content-type': contentType });
    if (!res.ok) throw new Error(`S3 PUT failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.request('GET', key);
    if (!res.ok) throw new Error(`S3 GET failed: HTTP ${res.status}`);
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}

/** AWS Signature Version 4 Authorization header for an S3 request.
 * `headers` are lower-case and include host, x-amz-date and
 * x-amz-content-sha256; all of them are signed. */
export function signV4(input: {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}): string {
  const amzDate = input.headers['x-amz-date']!;
  const date = amzDate.slice(0, 8);
  const names = Object.keys(input.headers).sort();
  const canonicalQuery = input.query
    .split('&')
    .filter(Boolean)
    .map((pair) => (pair.includes('=') ? pair : `${pair}=`))
    .sort()
    .join('&');
  const canonicalRequest = [
    input.method,
    input.path,
    canonicalQuery,
    names.map((name) => `${name}:${input.headers[name]!.trim()}\n`).join(''),
    names.join(';'),
    input.payloadHash,
  ].join('\n');
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}
