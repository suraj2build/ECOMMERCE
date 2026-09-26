import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@fcp/config';

export interface StoredEvidenceObject {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Private object-storage abstraction for return-condition evidence
 * (M19 independent-review repair, finding 2). Deliberately a MINIMAL
 * provider interface (put/get by a server-generated key only) - no
 * listing, no public URLs, no transformation pipeline. A future
 * production backend swaps in behind this SAME interface without
 * touching ReturnService.
 */
export interface EvidenceStorageProvider {
  putObject(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  getObject(key: string): Promise<StoredEvidenceObject>;
}

/**
 * Local-disk implementation - the provider actually used everywhere in
 * this pass (dev, CI, this sandbox). ADR-0007 scaffolds an S3-compatible
 * config surface (S3_ENDPOINT/S3_BUCKET) and a MinIO docker-compose
 * service, but NO client code anywhere in this codebase ever actually
 * called it before this repair, and no MinIO instance is reachable in
 * CI or this sandbox to test against - adding an untested S3 client
 * would violate "update acceptance only after real tests prove it", so
 * this is the minimum provider abstraction this pass can both build AND
 * genuinely verify. A real S3EvidenceStorageProvider can implement the
 * SAME interface later without any ReturnService change - see EXC-004-
 * adjacent note in blueprint/DECISION_REGISTER.md (RET-005 addendum).
 *
 * "Private" here means: the storage root is never registered as a
 * static-file directory by any Fastify plugin (grep the routes - it
 * isn't), so there is no public URL for any object regardless of key;
 * the ONLY way to read a file's bytes is through
 * ReturnService.getEvidenceContent, which re-checks ownership/RBAC on
 * every call before ever touching this provider.
 */
export class LocalDiskEvidenceStorageProvider implements EvidenceStorageProvider {
  private readonly root: string;
  private static readonly META_SUFFIX = '.meta.json';
  // Object keys are always server-generated UUIDs (generateEvidenceObjectKey)
  // - this pattern is a defence-in-depth check, not the primary guard,
  // so a key can never be abused for path traversal regardless of how
  // it reached this class.
  private static readonly KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? loadEnv().RETURN_EVIDENCE_STORAGE_DIR);
  }

  async putObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
    await fs.writeFile(filePath + LocalDiskEvidenceStorageProvider.META_SUFFIX, JSON.stringify({ mimeType }), { mode: 0o600 });
  }

  async getObject(key: string): Promise<StoredEvidenceObject> {
    const filePath = this.resolvePath(key);
    const [buffer, metaRaw] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(filePath + LocalDiskEvidenceStorageProvider.META_SUFFIX, 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw) as { mimeType: string };
    return { buffer, mimeType: meta.mimeType };
  }

  private resolvePath(key: string): string {
    if (!LocalDiskEvidenceStorageProvider.KEY_PATTERN.test(key)) {
      throw new Error('Invalid evidence object key');
    }
    return path.join(this.root, key);
  }
}

export function resolveEvidenceStorageProvider(): EvidenceStorageProvider {
  return new LocalDiskEvidenceStorageProvider();
}

/**
 * Sniffs the ACTUAL file type from its magic-number byte signature,
 * never the client-declared Content-Type/multipart mimetype - a
 * renamed-executable-as-"image/jpeg" upload is rejected here regardless
 * of what the request claims, closing the "reject unsupported/
 * executable payloads" requirement at the one point that can't be
 * spoofed by the caller. Returns null for anything unrecognized - the
 * caller then rejects the upload outright, it never falls back to
 * trusting the client's own claim.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Server-generated only - never derived from a client-supplied filename or path. */
export function generateEvidenceObjectKey(): string {
  return randomUUID();
}
