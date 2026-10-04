import { randomBytes, randomUUID } from 'node:crypto';
import { S3ObjectStore } from '../services/commerce-api/dist/lib/s3.js';

/**
 * LR-005 real-bucket check for return-evidence storage. Run it with the SAME
 * S3_* and RETURN_EVIDENCE_* settings (and credentials) the API will use, before
 * enabling RETURN_EVIDENCE_STORAGE=s3 in an environment:
 *
 *   npm run build -w @fcp/commerce-api
 *   S3_VERIFY_ALLOWED=yes node scripts/verify-s3-bucket.mjs
 *
 * It writes one small test object under <prefix>verify/, then checks:
 *   1. a signed upload and download round-trip the exact bytes and type;
 *   2. the object, the bucket listing and an upload are all refused without credentials;
 *   3. the object's ACL grants nothing to AllUsers/AuthenticatedUsers;
 *   4. (reported) server-side encryption and the bucket's Block Public Access setting.
 * It then deletes the test object. Exit code 0 only when every required check passes.
 * Credentials and signatures are never printed.
 */

if (process.env.S3_VERIFY_ALLOWED !== 'yes') throw new Error('Set S3_VERIFY_ALLOWED=yes to run this against the configured bucket.');
const env = process.env;
const required = ['ENDPOINT', 'REGION', 'ACCESS_KEY', 'SECRET_KEY'].map((name) => `S3_${name}`).concat('RETURN_EVIDENCE_S3_BUCKET');
const missing = required.filter((name) => !env[name]);
if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);

const prefix = env.RETURN_EVIDENCE_S3_PREFIX ?? 'return-evidence/';
const store = new S3ObjectStore({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY,
  secretAccessKey: env.S3_SECRET_KEY,
  bucket: env.RETURN_EVIDENCE_S3_BUCKET,
  // Same default as the API (packages/config): path-style unless set to anything but 'true'.
  forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
});

const results = [];
const check = (name, pass, detail, required = true) => results.push({ name, pass, detail, required });
const key = `${prefix}verify/${randomUUID()}.jpg`;
const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1024)]);
const anonymous = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }).then((r) => r.status).catch((e) => `error ${e.name}`);
const refused = (status) => status === 401 || status === 403;

let stored = false;
try {
  await store.put(key, body, 'image/jpeg');
  stored = true;
  check('Signed upload', true, `${key}`);
} catch (err) {
  check('Signed upload', false, err.message);
}

if (stored) {
  try {
    const back = await store.get(key);
    check('Signed download returns the same bytes and type', back.body.equals(body) && back.contentType === 'image/jpeg', `${back.body.length} bytes, ${back.contentType}`);
  } catch (err) {
    check('Signed download returns the same bytes and type', false, err.message);
  }

  const objectStatus = await anonymous(store.url(key));
  check('Object is not readable without credentials', refused(objectStatus), `anonymous GET -> ${objectStatus}`);

  const head = await store.request('HEAD', key);
  const sse = head.headers.get('x-amz-server-side-encryption');
  check('Server-side encryption (reported)', Boolean(sse), sse ?? 'no x-amz-server-side-encryption header', false);

  const acl = await store.request('GET', key, undefined, {}, 'acl');
  const aclText = await acl.text().catch(() => '');
  if (acl.ok) {
    check('Object ACL grants nothing to the public', !/AllUsers|AuthenticatedUsers/.test(aclText), /AllUsers|AuthenticatedUsers/.test(aclText) ? 'public grant found' : 'no AllUsers/AuthenticatedUsers grant');
  } else if ((acl.status === 403 && /<Code>AccessDenied<\/Code>/.test(aclText)) || acl.status === 501) {
    // Least-privilege credentials, or a store without ACLs: not a pass, but
    // the anonymous checks above are what decide whether objects are private.
    check('Object ACL (reported)', false, acl.status === 501 ? 'this store does not support ACLs (HTTP 501)' : 'ACL not readable with these credentials (AccessDenied)', false);
  } else {
    check('Object ACL grants nothing to the public', false, `ACL request failed: HTTP ${acl.status}${aclText.match(/<Code>([^<]+)<\/Code>/)?.[1] ? ` ${aclText.match(/<Code>([^<]+)<\/Code>/)[1]}` : ''}`);
  }
}

const listStatus = await anonymous(store.url(''));
check('Bucket cannot be listed without credentials', refused(listStatus), `anonymous LIST -> ${listStatus}`);

const anonKey = `${prefix}verify/${randomUUID()}.jpg`;
const putStatus = await anonymous(store.url(anonKey), { method: 'PUT', body, headers: { 'content-type': 'image/jpeg' } });
check('Nobody can upload without credentials', refused(putStatus), `anonymous PUT -> ${putStatus}`);

const pab = await store.request('GET', '', undefined, {}, 'publicAccessBlock');
const pabText = pab.ok ? await pab.text() : '';
const allBlocked = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every((f) => new RegExp(`<${f}>true</${f}>`).test(pabText));
check('Block Public Access (reported)', pab.ok && allBlocked, pab.ok ? (allBlocked ? 'all four settings on' : 'not all four settings on') : `not readable with these credentials (HTTP ${pab.status})`, false);

if (stored) {
  const del = await store.request('DELETE', key);
  check('Test object removed', del.status === 204 || del.status === 200, del.ok ? 'deleted' : `HTTP ${del.status}: the app does not need DELETE; remove ${key} by hand`, false);
}

for (const r of results) console.log(`${r.pass ? 'PASS' : r.required ? 'FAIL' : 'NOTE'}  ${r.name}: ${r.detail}`);
const failed = results.filter((r) => r.required && !r.pass);
console.log(failed.length ? `\n${failed.length} required check(s) failed.` : '\nAll required checks passed.');
process.exit(failed.length ? 1 : 0);
