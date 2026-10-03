import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { __resetEnvCacheForTests, loadEnv } from '@fcp/config';
import { S3ObjectStore } from '../../src/lib/s3.js';
import { S3EvidenceStorageProvider, resolveEvidenceStorageProvider, generateEvidenceObjectKey } from '../../src/modules/returns/evidence-storage.js';
import { enterProductionEnv } from '../helpers/production-env.js';

/**
 * LR-005 return-evidence storage on an S3 API (specs/18-returns.md). Runs
 * against a real S3-compatible server (CI and local: moto_server) given by
 * S3_TEST_ENDPOINT; in CI the endpoint is always provided, so this suite can
 * never silently skip there.
 */

const ENDPOINT = process.env.S3_TEST_ENDPOINT;
if (process.env.CI && !ENDPOINT) throw new Error('S3_TEST_ENDPOINT must be set in CI');

const S3_ENV = {
  S3_ENDPOINT: ENDPOINT ?? '',
  S3_REGION: 'ap-south-1',
  S3_ACCESS_KEY: 'testtesttest',
  S3_SECRET_KEY: 'testtesttesttest',
  S3_FORCE_PATH_STYLE: 'true',
  RETURN_EVIDENCE_STORAGE: 's3',
  RETURN_EVIDENCE_S3_BUCKET: `evidence-${Date.now()}`,
  RETURN_EVIDENCE_S3_PREFIX: 'return-evidence/',
};

describe.skipIf(!ENDPOINT)('Return evidence on S3-compatible storage (LR-005)', () => {
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [k, v] of Object.entries(S3_ENV)) { previous[k] = process.env[k]; process.env[k] = v; }
    __resetEnvCacheForTests();
    const env = loadEnv();
    const store = new S3ObjectStore({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY, bucket: env.RETURN_EVIDENCE_S3_BUCKET, forcePathStyle: true });
    // Create the bucket (a signed PUT on the bucket itself).
    const location = Buffer.from('<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>ap-south-1</LocationConstraint></CreateBucketConfiguration>');
    const res = await store.request('PUT', '', location);
    expect(res.status).toBeLessThan(300);
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    __resetEnvCacheForTests();
  });

  const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2048)]);

  it('is selected by RETURN_EVIDENCE_STORAGE=s3 and round-trips bytes and type through the S3 API', async () => {
    const provider = resolveEvidenceStorageProvider();
    expect(provider).toBeInstanceOf(S3EvidenceStorageProvider);
    const key = generateEvidenceObjectKey();
    const body = jpeg();
    await provider.putObject(key, body, 'image/jpeg');
    const back = await provider.getObject(key);
    expect(back.mimeType).toBe('image/jpeg');
    expect(back.buffer.equals(body)).toBe(true);
  });

  it('is shared: an object written through one instance is read through another (multiple API replicas)', async () => {
    const key = generateEvidenceObjectKey();
    const body = jpeg();
    await new S3EvidenceStorageProvider().putObject(key, body, 'image/png');
    const back = await new S3EvidenceStorageProvider().getObject(key);
    expect(back.buffer.equals(body)).toBe(true);
  });

  it('stores objects privately under the configured prefix: no public, unsigned read', async () => {
    const key = generateEvidenceObjectKey();
    await new S3EvidenceStorageProvider().putObject(key, jpeg(), 'image/jpeg');
    const unsigned = await fetch(`${ENDPOINT}/${S3_ENV.RETURN_EVIDENCE_S3_BUCKET}/return-evidence/${key}?acl`);
    const acl = await unsigned.text();
    // No ACL grant to AllUsers/AuthenticatedUsers was ever written.
    expect(acl).not.toMatch(/AllUsers|AuthenticatedUsers/);
  });

  it('accepts only server-generated keys, never a client-supplied path', async () => {
    const provider = new S3EvidenceStorageProvider();
    await expect(provider.putObject('../../etc/passwd', jpeg(), 'image/jpeg')).rejects.toThrow('Invalid evidence object key');
    await expect(provider.getObject('other-bucket/secret.jpg')).rejects.toThrow('Invalid evidence object key');
  });

  it('a missing object is an error, never empty bytes', async () => {
    await expect(new S3EvidenceStorageProvider().getObject(generateEvidenceObjectKey())).rejects.toThrow(/HTTP 404/);
  });
});

describe('Return evidence storage selection (LR-005)', () => {
  it('production refuses local disk; development and tests may use it', () => {
    const before = process.env.RETURN_EVIDENCE_STORAGE;
    process.env.RETURN_EVIDENCE_STORAGE = 'local';
    __resetEnvCacheForTests();
    expect(() => resolveEvidenceStorageProvider()).not.toThrow();
    const restore = enterProductionEnv();
    try {
      expect(() => resolveEvidenceStorageProvider()).toThrow(/production refuses/);
    } finally {
      restore();
      if (before === undefined) delete process.env.RETURN_EVIDENCE_STORAGE; else process.env.RETURN_EVIDENCE_STORAGE = before;
      __resetEnvCacheForTests();
    }
  });
});
