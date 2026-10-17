import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv, mockProvidersAllowed, type Env } from '@fcp/config';
import { S3ObjectStore } from '../../lib/s3.js';

/**
 * specs/36: storage for PUBLIC customer review photos.
 *
 * Deliberately separate from both the public product-media store
 * (product/media-storage.ts) and the private return-evidence store
 * (returns/evidence-storage.ts): its own directory or bucket/prefix, its
 * own key format, and its own read route. A review photo key can never
 * name an object in either of those, and neither of their read routes
 * ever reads here.
 *
 * Objects are immutable: a review's photo is written once; there is no
 * "replace" operation in this spec (a customer with a different photo in
 * mind submits a new review photo request, which this module does not yet
 * support removing/replacing - out of scope per specs/36).
 */
export interface ReviewPhotoStore {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<{ buffer: Buffer; mimeType: string }>;
  /** A real write, read and delete of a small probe object. */
  probe(): Promise<void>;
  readonly kind: 'local' | 's3';
}

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** `<uuid>.<ext>` - always server-generated. */
export const REVIEW_PHOTO_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function newReviewPhotoKey(mimeType: string): string {
  const ext = EXTENSION[mimeType];
  if (!ext) throw new Error(`Unsupported review photo type ${mimeType}`);
  return `${randomUUID()}.${ext}`;
}

export class LocalDiskReviewPhotoStore implements ReviewPhotoStore {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? loadEnv().REVIEW_PHOTO_STORAGE_DIR);
  }

  private file(key: string): string {
    if (!REVIEW_PHOTO_KEY.test(key)) throw new Error('Invalid review photo key');
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

export class S3ReviewPhotoStore implements ReviewPhotoStore {
  readonly kind = 's3' as const;
  private readonly store: S3ObjectStore;
  private readonly prefix: string;

  constructor(env: Env = loadEnv()) {
    this.store = new S3ObjectStore({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      bucket: env.REVIEW_PHOTO_S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
    this.prefix = env.REVIEW_PHOTO_S3_PREFIX;
  }

  private objectKey(key: string): string {
    if (!REVIEW_PHOTO_KEY.test(key)) throw new Error('Invalid review photo key');
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

export function resolveReviewPhotoStore(env: Env = loadEnv()): ReviewPhotoStore {
  if (env.REVIEW_PHOTO_STORAGE === 's3') return new S3ReviewPhotoStore(env);
  if (!mockProvidersAllowed(env)) {
    throw new Error('Review photo storage is local disk, which production refuses: set REVIEW_PHOTO_STORAGE=s3 (DEPLOYMENT.md)');
  }
  return new LocalDiskReviewPhotoStore();
}
