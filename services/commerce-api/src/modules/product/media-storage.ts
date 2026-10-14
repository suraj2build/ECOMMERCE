import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv, mockProvidersAllowed, type Env } from '@fcp/config';
import { S3ObjectStore } from '../../lib/s3.js';

/**
 * Admin Ops Phase 1: storage for PUBLIC product photos uploaded in admin.
 *
 * Deliberately separate from the private return-evidence store
 * (returns/evidence-storage.ts): its own directory or bucket/prefix, its
 * own key format, and its own read route. A product photo key can never
 * name a return-evidence object, and the evidence route never reads here.
 *
 * Objects are immutable: a replacement photo is written as a new object
 * under a new key BEFORE the product record is switched to it, so a failed
 * upload never loses the current photo. Removing or replacing a photo
 * never deletes stored bytes (no destructive delete from admin); the
 * public read route only serves keys a ProductMedia row still references,
 * so a removed photo stops being served.
 */
export interface ProductMediaStore {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<{ buffer: Buffer; mimeType: string }>;
  /** A real write, read and delete of a small probe object. */
  probe(): Promise<void>;
  readonly kind: 'local' | 's3';
}

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** `<uuid>.<ext>` - always server-generated. */
export const PRODUCT_MEDIA_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function newProductMediaKey(mimeType: string): string {
  const ext = EXTENSION[mimeType];
  if (!ext) throw new Error(`Unsupported product media type ${mimeType}`);
  return `${randomUUID()}.${ext}`;
}

/** The URL stored on ProductMedia: relative to the storefront, which proxies it to the API. */
export function productMediaUrl(key: string): string {
  return `/media/products/${key}`;
}

export class LocalDiskProductMediaStore implements ProductMediaStore {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? loadEnv().PRODUCT_MEDIA_STORAGE_DIR);
  }

  private file(key: string): string {
    if (!PRODUCT_MEDIA_KEY.test(key)) throw new Error('Invalid product media key');
    return path.join(this.root, key);
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    // wx: never overwrite an existing object (keys are immutable).
    await fs.writeFile(this.file(key), buffer, { flag: 'wx', mode: 0o644 });
    await fs.writeFile(`${this.file(key)}.meta.json`, JSON.stringify({ mimeType }), { flag: 'wx', mode: 0o644 });
  }

  async get(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const [buffer, meta] = await Promise.all([fs.readFile(this.file(key)), fs.readFile(`${this.file(key)}.meta.json`, 'utf8')]);
    return { buffer, mimeType: (JSON.parse(meta) as { mimeType: string }).mimeType };
  }

  async probe(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const probe = path.join(this.root, `.probe-${randomUUID()}`);
    await fs.writeFile(probe, 'ok');
    const read = await fs.readFile(probe, 'utf8');
    await fs.rm(probe);
    if (read !== 'ok') throw new Error('read back a different value');
  }
}

export class S3ProductMediaStore implements ProductMediaStore {
  readonly kind = 's3' as const;
  private readonly store: S3ObjectStore;
  private readonly prefix: string;

  constructor(env: Env = loadEnv()) {
    this.store = new S3ObjectStore({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      bucket: env.PRODUCT_MEDIA_S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
    this.prefix = env.PRODUCT_MEDIA_S3_PREFIX;
  }

  private objectKey(key: string): string {
    if (!PRODUCT_MEDIA_KEY.test(key)) throw new Error('Invalid product media key');
    return `${this.prefix}${key}`;
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.store.put(this.objectKey(key), buffer, mimeType);
  }

  async get(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const { body, contentType } = await this.store.get(this.objectKey(key));
    return { buffer: body, mimeType: contentType };
  }

  async probe(): Promise<void> {
    const key = `${this.prefix}.probe-${randomUUID()}`;
    await this.store.put(key, Buffer.from('ok'), 'text/plain');
    const { body } = await this.store.get(key);
    const del = await this.store.request('DELETE', key);
    if (body.toString() !== 'ok') throw new Error('read back a different value');
    if (!del.ok && del.status !== 404) throw new Error(`could not delete the probe object (HTTP ${del.status})`);
  }
}

export function resolveProductMediaStore(env: Env = loadEnv()): ProductMediaStore {
  if (env.PRODUCT_MEDIA_STORAGE === 's3') return new S3ProductMediaStore(env);
  if (!mockProvidersAllowed(env)) {
    throw new Error('Product photo storage is local disk, which production refuses: set PRODUCT_MEDIA_STORAGE=s3 (DEPLOYMENT.md)');
  }
  return new LocalDiskProductMediaStore();
}
