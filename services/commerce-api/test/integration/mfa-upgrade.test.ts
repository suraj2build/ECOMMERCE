import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { __resetEnvCacheForTests } from '@fcp/config';
import { hashPassword } from '@fcp/shared';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, testPrisma } from '../helpers/db.js';
import { generateMfaSecret } from '../../src/modules/auth/mfa.js';
import { encryptMfaSecret, decryptMfaSecret, classifyStoredMfaSecret } from '../../src/modules/auth/mfa-secret-crypto.js';
import {
  backfillLegacyMfaSecrets,
  upgradeStoredMfaSecret,
  MfaBackfillPreflightError,
} from '../../src/modules/auth/mfa-secret-backfill.js';
import { runMfaBackfillCli } from '../../src/scripts/backfill-mfa-secrets.js';

/**
 * M31 certification repair - MFA upgrade compatibility.
 *
 * Every "pre-M31 user" here is created in exactly the state pre-M31
 * code left behind: pre-M31 `/auth/staff/mfa/enroll` wrote
 * `mfaSecret: generateMfaSecret()` (the raw otplib base32 seed, same
 * unchanged function imported here) and `/mfa/confirm` set
 * `mfaEnabled: true`. The HTTP-level assertions then drive the CURRENT
 * login route. (The same path is additionally exercised end to end with
 * the actual pre-M31 code from a git worktree - see the final report.)
 *
 * Logging is captured at trace level through a real log destination,
 * with per-request logging switched on, so the "never logged" assertion
 * inspects genuine request/response log output.
 *
 * The server verifies TOTP codes for the current 30s step only, so each
 * test freezes Date at the middle of a step: the code the test generates
 * and the code the server expects always come from the same step, however
 * slow the password hash is under load.
 */
process.env.LOG_LEVEL = 'trace';
__resetEnvCacheForTests();

const PASSWORD = 'CorrectPassword123!';
const logLines: string[] = [];
const logSink = new Writable({
  write(chunk, _enc, cb) {
    logLines.push(chunk.toString());
    cb();
  },
});

describe('MFA upgrade compatibility (M31 certification repair)', () => {
  let app: FastifyInstance;
  const responses: string[] = [];
  const allSeeds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp({ logDestination: logSink, requestLogging: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
    const step = 30_000;
    vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / step) * step + step / 2 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A staff user exactly as pre-M31 code left them: plaintext seed, MFA confirmed. */
  async function preM31MfaUser(label: string) {
    const email = `${label}-${randomUUID().slice(0, 8)}@example.com`;
    const seed = generateMfaSecret();
    allSeeds.push(seed);
    const staff = await testPrisma.staffUser.create({
      data: { email, passwordHash: await hashPassword(PASSWORD), fullName: label, isActive: true, mfaSecret: seed, mfaEnabled: true },
    });
    const role = await testPrisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await testPrisma.staffUserRole.create({ data: { staffUserId: staff.id, roleId: role.id } });
    return { id: staff.id, email, seed };
  }

  async function login(email: string, seed: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/login',
      payload: { email, password: PASSWORD, mfaCode: authenticator.generate(seed) },
    });
    responses.push(res.body);
    return res;
  }

  async function stored(id: string): Promise<string> {
    return (await testPrisma.staffUser.findUniqueOrThrow({ where: { id } })).mfaSecret!;
  }

  it('A/B/C/D: a pre-M31 plaintext user is refused (not 500, no plaintext fallback) until the backfill runs, then logs in with the same TOTP seed', async () => {
    const user = await preM31MfaUser('pre-m31');
    expect(classifyStoredMfaSecret(await stored(user.id))).toBe('legacy-plaintext');

    // No plaintext fallback in the authentication path: a correct TOTP
    // for the plaintext seed is still refused, cleanly.
    const before = await login(user.email, user.seed);
    expect(before.statusCode).toBe(401);
    const denial = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff.mfa.secret_unreadable', entityId: user.id } });
    expect(denial.reference).toBe('legacy_plaintext_requires_backfill');

    const report = await backfillLegacyMfaSecrets(testPrisma);
    expect(report).toMatchObject({ scanned: 1, encryptedLegacyPlaintext: 1, alreadyV1: 0, unreadableStaffUserIds: [] });

    const after = await stored(user.id);
    expect(classifyStoredMfaSecret(after)).toBe('v1'); // B: encrypted
    expect(after).not.toContain(user.seed); // B: plaintext gone from the column
    expect(decryptMfaSecret(after)).toBe(user.seed); // C: logically identical seed
    expect((await testPrisma.staffUser.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(true); // enrollment preserved

    const res = await login(user.email, user.seed); // D
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeTruthy();
  });

  it('upgrades an in-progress (not yet confirmed) pre-M31 enrollment too, which can then be confirmed', async () => {
    const user = await preM31MfaUser('pending');
    await testPrisma.staffUser.update({ where: { id: user.id }, data: { mfaEnabled: false } });
    await backfillLegacyMfaSecrets(testPrisma);
    expect(decryptMfaSecret(await stored(user.id))).toBe(user.seed);

    const bootstrap = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email: user.email, password: PASSWORD } });
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/mfa/confirm',
      headers: { authorization: `Bearer ${bootstrap.json().token}` },
      payload: { code: authenticator.generate(user.seed) },
    });
    expect(confirm.statusCode).toBe(200);
  });

  it('E/F: re-running the backfill is a no-op - no rewrite, no double encryption', async () => {
    const users = [await preM31MfaUser('idem-1'), await preM31MfaUser('idem-2')];
    await backfillLegacyMfaSecrets(testPrisma);
    const firstPass = await Promise.all(users.map((u) => stored(u.id)));

    const second = await backfillLegacyMfaSecrets(testPrisma);
    expect(second).toMatchObject({ scanned: 2, alreadyV1: 2, encryptedLegacyPlaintext: 0, rewrappedUnversionedCiphertext: 0 });
    const secondPass = await Promise.all(users.map((u) => stored(u.id)));
    expect(secondPass).toEqual(firstPass); // byte-identical

    for (const [i, u] of users.entries()) {
      expect(decryptMfaSecret(secondPass[i]!)).toBe(u.seed); // one layer only
    }
  });

  it('re-wraps the never-released unversioned M31 ciphertext as v1 without changing the seed', async () => {
    const user = await preM31MfaUser('unversioned');
    const v1 = encryptMfaSecret(user.seed);
    const unversioned = v1.slice('v1:'.length);
    await testPrisma.staffUser.update({ where: { id: user.id }, data: { mfaSecret: unversioned } });

    const report = await backfillLegacyMfaSecrets(testPrisma);
    expect(report.rewrappedUnversionedCiphertext).toBe(1);
    expect(decryptMfaSecret(await stored(user.id))).toBe(user.seed);
    expect((await login(user.email, user.seed)).statusCode).toBe(200);
  });

  it('G/H: a corrupted encrypted value fails safely at login and is never treated as plaintext or rewritten by the backfill', async () => {
    const good = await preM31MfaUser('good');
    const user = await preM31MfaUser('corrupt');
    await backfillLegacyMfaSecrets(testPrisma);
    const valid = await stored(user.id);
    const parts = valid.split(':');
    parts[3] = (parts[3]![0] === 'a' ? 'b' : 'a') + parts[3]!.slice(1);
    const corrupted = parts.join(':');
    await testPrisma.staffUser.update({ where: { id: user.id }, data: { mfaSecret: corrupted } });

    const res = await login(user.email, user.seed);
    expect(res.statusCode).toBe(401);
    const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff.mfa.secret_unreadable', entityId: user.id } });
    expect(audit.reference).toBe('decrypt_failed');

    // One valid and one undecryptable v1 row: the backfill refuses outright (ids only) and writes nothing.
    const goodBefore = await stored(good.id);
    const aborted = await backfillLegacyMfaSecrets(testPrisma).catch((err: unknown) => err);
    expect(aborted).toBeInstanceOf(MfaBackfillPreflightError);
    expect((aborted as MfaBackfillPreflightError).undecryptableStaffUserIds).toEqual([user.id]);
    expect(await stored(user.id)).toBe(corrupted); // untouched - no guess, no fallback
    expect(await stored(good.id)).toBe(goodBefore);
    expect((await login(good.email, good.seed)).statusCode).toBe(200); // others unaffected
  });

  it('an unrecognized stored value is refused at login and reported (id only) by the backfill', async () => {
    const user = await preM31MfaUser('garbage');
    await testPrisma.staffUser.update({ where: { id: user.id }, data: { mfaSecret: 'not a valid mfa secret' } });
    expect((await login(user.email, user.seed)).statusCode).toBe(401);
    const report = await backfillLegacyMfaSecrets(testPrisma);
    expect(report.unreadableStaffUserIds).toEqual([user.id]);
    expect(await stored(user.id)).toBe('not a valid mfa secret');
  });

  it('I: a value encrypted under a different key fails safely at login, and a backfill whose key does not decrypt the existing v1 rows writes nothing', async () => {
    const otherKey = randomBytes(32);
    const encryptedElsewhere = await preM31MfaUser('other-key');
    await testPrisma.staffUser.update({
      where: { id: encryptedElsewhere.id },
      data: { mfaSecret: encryptMfaSecret(encryptedElsewhere.seed, otherKey) },
    });
    const legacy = await preM31MfaUser('legacy-waiting');

    expect((await login(encryptedElsewhere.email, encryptedElsewhere.seed)).statusCode).toBe(401);
    const audit = await testPrisma.auditLog.findFirstOrThrow({ where: { action: 'staff.mfa.secret_unreadable', entityId: encryptedElsewhere.id } });
    expect(audit.reference).toBe('decrypt_failed');

    const elsewhereBefore = await stored(encryptedElsewhere.id);
    await expect(backfillLegacyMfaSecrets(testPrisma)).rejects.toBeInstanceOf(MfaBackfillPreflightError);
    expect(await stored(legacy.id)).toBe(legacy.seed); // not encrypted with the wrong key
    expect(await stored(encryptedElsewhere.id)).toBe(elsewhereBefore);
  });

  it('J: a new enrollment through the current routes is stored encrypted (v1) and works end to end', async () => {
    const email = `new-enroll-${randomUUID().slice(0, 8)}@example.com`;
    const staff = await testPrisma.staffUser.create({
      data: { email, passwordHash: await hashPassword(PASSWORD), fullName: 'New', isActive: true },
    });
    const role = await testPrisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
    await testPrisma.staffUserRole.create({ data: { staffUserId: staff.id, roleId: role.id } });

    const bootstrap = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/login', payload: { email, password: PASSWORD } });
    const token = bootstrap.json().token as string;
    // The enrollment response is the one intended disclosure of the seed
    // (the otpauth:// URL the authenticated user scans), so it is not added
    // to the leak-check haystack; its seed IS checked everywhere else.
    const enroll = await app.inject({ method: 'POST', url: '/api/v1/auth/staff/mfa/enroll', headers: { authorization: `Bearer ${token}` } });
    const seed = new URL(enroll.json().otpAuthUrl.replace('otpauth://totp/', 'http://x/')).searchParams.get('secret')!;
    allSeeds.push(seed);

    const saved = await stored(staff.id);
    expect(classifyStoredMfaSecret(saved)).toBe('v1');
    expect(decryptMfaSecret(saved)).toBe(seed);

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/staff/mfa/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: authenticator.generate(seed) },
    });
    expect(confirm.statusCode).toBe(200);
    expect((await login(email, seed)).statusCode).toBe(200);
  });

  describe('K: concurrency', () => {
    it('two backfills racing each other convert every row exactly once and agree on the seed', async () => {
      const users = await Promise.all(Array.from({ length: 6 }, (_, i) => preM31MfaUser(`race-${i}`)));
      const [a, b] = await Promise.all([backfillLegacyMfaSecrets(testPrisma), backfillLegacyMfaSecrets(testPrisma)]);

      expect(a.encryptedLegacyPlaintext + b.encryptedLegacyPlaintext).toBe(6);
      expect(a.encryptedLegacyPlaintext + a.skippedConcurrentlyChanged + a.alreadyV1).toBe(6);
      expect(b.encryptedLegacyPlaintext + b.skippedConcurrentlyChanged + b.alreadyV1).toBe(6);
      for (const u of users) {
        const value = await stored(u.id);
        expect(classifyStoredMfaSecret(value)).toBe('v1');
        expect(decryptMfaSecret(value)).toBe(u.seed);
      }
    });

    it('a backfill that read a value before a concurrent re-enrollment never overwrites the new enrollment (compare-and-swap)', async () => {
      const user = await preM31MfaUser('reenroll');
      const observedByBackfill = await stored(user.id); // backfill has read the plaintext...

      const newSeed = generateMfaSecret(); // ...then the user re-enrolls through the current code
      allSeeds.push(newSeed);
      await testPrisma.staffUser.update({ where: { id: user.id }, data: { mfaSecret: encryptMfaSecret(newSeed), mfaEnabled: false } });

      const outcome = await upgradeStoredMfaSecret(testPrisma, user.id, observedByBackfill);
      expect(outcome).toBe('skipped-concurrently-changed');
      expect(decryptMfaSecret(await stored(user.id))).toBe(newSeed);
    });

    it('logins racing the backfill never error or corrupt state; the account works once the backfill has run', async () => {
      const user = await preM31MfaUser('login-race');
      const [report, ...logins] = await Promise.all([
        backfillLegacyMfaSecrets(testPrisma),
        login(user.email, user.seed),
        login(user.email, user.seed),
        login(user.email, user.seed),
      ]);
      expect(report.encryptedLegacyPlaintext).toBe(1);
      for (const res of logins) expect([200, 401]).toContain(res.statusCode);
      const value = await stored(user.id);
      expect(classifyStoredMfaSecret(value)).toBe('v1');
      expect(decryptMfaSecret(value)).toBe(user.seed);
      expect((await login(user.email, user.seed)).statusCode).toBe(200);
    });
  });

  it('L: no MFA seed ever appears in logs, audit rows, HTTP responses or the backfill CLI output', async () => {
    const legacy = await preM31MfaUser('leak-legacy');
    const corrupt = await preM31MfaUser('leak-corrupt');
    await testPrisma.staffUser.update({ where: { id: corrupt.id }, data: { mfaSecret: `${corrupt.seed}-corrupted!` } });

    await login(legacy.email, legacy.seed); // refused: legacy plaintext
    await login(corrupt.email, corrupt.seed); // refused: unrecognized
    const cliOutput: string[] = [];
    await runMfaBackfillCli({ prisma: testPrisma, write: (line) => cliOutput.push(line) });
    await login(legacy.email, legacy.seed); // succeeds

    const audit = JSON.stringify(await testPrisma.auditLog.findMany());
    const haystacks = { logs: logLines.join('\n'), audit, responses: responses.join('\n'), cli: cliOutput.join('\n') };
    expect(logLines.length).toBeGreaterThan(0); // the capture is genuinely wired up
    expect(cliOutput).toHaveLength(1);
    for (const seed of allSeeds) {
      for (const [where, text] of Object.entries(haystacks)) {
        expect(text.includes(seed), `seed leaked into ${where}`).toBe(false);
      }
    }
  });
});
