import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@fcp/db';
import { __resetEnvCacheForTests } from '@fcp/config';
import { resetDatabase, seedRbac, testPrisma } from '../helpers/db.js';
import { createTestApp } from '../helpers/app.js';
import { generateMfaSecret } from '../../src/modules/auth/mfa.js';
import { encryptMfaSecret, decryptMfaSecret, classifyStoredMfaSecret } from '../../src/modules/auth/mfa-secret-crypto.js';
import {
  backfillLegacyMfaSecrets,
  MfaBackfillPreflightError,
  MfaStartupBlockedError,
} from '../../src/modules/auth/mfa-secret-backfill.js';
import { runMfaBackfillCli } from '../../src/scripts/backfill-mfa-secrets.js';
import { startServer } from '../../src/server.js';

/**
 * M31 final delta repair - MFA upgrade safety.
 *
 * Blocker 1: the backfill must write nothing unless EVERY existing
 * encrypted MFA value decrypts with the configured key (previously it only
 * aborted when all of them failed).
 * Blocker 2: in production, startup must refuse to listen while any
 * non-v1 MFA secret remains, or when that check itself cannot run.
 *
 * "Zero writes" is proven by snapshotting every staff_users row
 * (including updatedAt) before and after. Startup is tested through
 * startServer(), the exact function src/index.ts uses between buildApp()
 * and listening (a full production process cannot boot in any
 * environment today: the production guard refuses the MOCK shipping
 * provider until a real carrier is selected - SHIP-001).
 */

const CLI_PATH = fileURLToPath(new URL('../../src/scripts/backfill-mfa-secrets.ts', import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

async function staffUser(label: string, mfaSecret: string | null) {
  return testPrisma.staffUser.create({
    data: {
      email: `${label}-${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: 'x',
      fullName: label,
      isActive: true,
      mfaSecret,
      mfaEnabled: mfaSecret !== null,
    },
  });
}

function tamperCiphertext(v1: string): string {
  const parts = v1.split(':');
  parts[3] = (parts[3]![0] === 'a' ? 'b' : 'a') + parts[3]!.slice(1);
  return parts.join(':');
}

async function snapshot(): Promise<string> {
  const rows = await testPrisma.staffUser.findMany({ orderBy: { id: 'asc' } });
  return JSON.stringify(rows);
}

/** Seeds and every stored value created in a test - none may ever appear in output. */
const secrets: string[] = [];

async function mixedState() {
  const validSeed = generateMfaSecret();
  const corruptSeed = generateMfaSecret();
  const legacySeed = generateMfaSecret();
  const validV1 = encryptMfaSecret(validSeed);
  const corruptV1 = tamperCiphertext(encryptMfaSecret(corruptSeed));
  secrets.push(validSeed, corruptSeed, legacySeed, validV1, corruptV1);
  const valid = await staffUser('valid-v1', validV1);
  const corrupt = await staffUser('corrupt-v1', corruptV1);
  const legacy = await staffUser('legacy', legacySeed);
  return { valid, corrupt, legacy, validSeed, legacySeed };
}

function runCliProcess(): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [TSX_CLI, CLI_PATH], { env: process.env, timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? null : 0;
      resolve({ code, output: `${stdout}${stderr}` });
    });
  });
}

describe('MFA upgrade safety (M31 final delta repair)', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  describe('Blocker 1 - backfill preflight', () => {
    it('1. mixed valid-v1 + corrupt-v1 + legacy state aborts with ZERO writes and reports ids only', async () => {
      const { corrupt, legacy, legacySeed } = await mixedState();
      const before = await snapshot();

      const err = await backfillLegacyMfaSecrets(testPrisma).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MfaBackfillPreflightError);
      expect((err as MfaBackfillPreflightError).undecryptableStaffUserIds).toEqual([corrupt.id]);

      expect(await snapshot()).toBe(before); // every row byte-identical, including updatedAt
      const legacyAfter = await testPrisma.staffUser.findUniqueOrThrow({ where: { id: legacy.id } });
      expect(legacyAfter.mfaSecret).toBe(legacySeed); // legacy NOT encrypted despite a valid v1 row existing
      expect(classifyStoredMfaSecret(legacyAfter.mfaSecret!)).toBe('legacy-plaintext');
    });

    it('1b. the real CLI process exits non-zero on the mixed state, modifies nothing, and prints ids only', async () => {
      const { corrupt } = await mixedState();
      const before = await snapshot();

      const { code, output } = await runCliProcess();
      expect(code).toBe(1);
      expect(output).toContain('"aborted":"preflight"');
      expect(output).toContain('"rowsModified":0');
      expect(output).toContain(corrupt.id);
      expect(await snapshot()).toBe(before);
      for (const secret of secrets) expect(output.includes(secret), 'secret leaked into CLI output').toBe(false);
    });

    it('2. a wrong MFA encryption key (no v1 row decrypts) aborts with ZERO writes', async () => {
      const otherKey = randomBytes(32);
      const seedA = generateMfaSecret();
      const seedB = generateMfaSecret();
      const legacySeed = generateMfaSecret();
      secrets.push(seedA, seedB, legacySeed);
      const a = await staffUser('wrong-key-a', encryptMfaSecret(seedA, otherKey));
      const b = await staffUser('wrong-key-b', encryptMfaSecret(seedB, otherKey));
      await staffUser('legacy', legacySeed);
      const before = await snapshot();

      const err = await backfillLegacyMfaSecrets(testPrisma).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MfaBackfillPreflightError);
      expect([...(err as MfaBackfillPreflightError).undecryptableStaffUserIds].sort()).toEqual([a.id, b.id].sort());
      expect(await snapshot()).toBe(before);
    });

    it('2b. an unversioned ciphertext row that does not decrypt also blocks every write', async () => {
      const seed = generateMfaSecret();
      const legacySeed = generateMfaSecret();
      secrets.push(seed, legacySeed);
      const foreign = encryptMfaSecret(seed, randomBytes(32)).slice('v1:'.length);
      const bad = await staffUser('unversioned-bad', foreign);
      await staffUser('legacy', legacySeed);
      const before = await snapshot();

      const err = await backfillLegacyMfaSecrets(testPrisma).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MfaBackfillPreflightError);
      expect((err as MfaBackfillPreflightError).undecryptableStaffUserIds).toEqual([bad.id]);
      expect(await snapshot()).toBe(before);
    });

    it('3. all-valid existing v1 plus legacy plaintext migrates the legacy rows and leaves v1 rows untouched', async () => {
      const validSeed = generateMfaSecret();
      const legacySeed = generateMfaSecret();
      secrets.push(validSeed, legacySeed);
      const validV1 = encryptMfaSecret(validSeed);
      const valid = await staffUser('valid-v1', validV1);
      const legacy = await staffUser('legacy', legacySeed);

      const report = await backfillLegacyMfaSecrets(testPrisma);
      expect(report).toMatchObject({ scanned: 2, alreadyV1: 1, encryptedLegacyPlaintext: 1, unreadableStaffUserIds: [] });

      expect((await testPrisma.staffUser.findUniqueOrThrow({ where: { id: valid.id } })).mfaSecret).toBe(validV1);
      const migrated = (await testPrisma.staffUser.findUniqueOrThrow({ where: { id: legacy.id } })).mfaSecret!;
      expect(classifyStoredMfaSecret(migrated)).toBe('v1');
      expect(decryptMfaSecret(migrated)).toBe(legacySeed);
    });

    it('4. a successful migration is idempotent - a rerun writes nothing', async () => {
      const legacySeed = generateMfaSecret();
      secrets.push(legacySeed);
      await staffUser('valid-v1', encryptMfaSecret(generateMfaSecret()));
      await staffUser('legacy', legacySeed);
      await backfillLegacyMfaSecrets(testPrisma);
      const after = await snapshot();

      const rerun = await backfillLegacyMfaSecrets(testPrisma);
      expect(rerun).toMatchObject({ scanned: 2, alreadyV1: 2, encryptedLegacyPlaintext: 0, rewrappedUnversionedCiphertext: 0 });
      expect(await snapshot()).toBe(after);
    });

    it('the in-process CLI runner reports the preflight abort with a count and ids, never values', async () => {
      const { corrupt } = await mixedState();
      const lines: string[] = [];
      await expect(runMfaBackfillCli({ prisma: testPrisma, write: (l) => lines.push(l) })).rejects.toBeInstanceOf(
        MfaBackfillPreflightError,
      );
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!.replace('[mfa-backfill] ', ''))).toEqual({
        aborted: 'preflight',
        rowsModified: 0,
        undecryptableCount: 1,
        undecryptableStaffUserIds: [corrupt.id],
      });
    });
  });

  describe('Blocker 2 - production startup gate', () => {
    let app: FastifyInstance;
    const logLines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString());
        cb();
      },
    });

    const previousLogLevel = process.env.LOG_LEVEL;

    beforeEach(async () => {
      logLines.length = 0;
      process.env.LOG_LEVEL = 'trace'; // capture every level, so the no-leak check sees real output
      __resetEnvCacheForTests();
      app = await createTestApp({ logDestination: sink });
    });

    afterEach(async () => {
      await app.close();
      process.env.LOG_LEVEL = previousLogLevel;
      __resetEnvCacheForTests();
    });

    const logged = () => logLines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const opts = (production: boolean) => ({ production, port: 0, host: '127.0.0.1' });

    it('5. production startup refuses to listen while non-v1 MFA rows remain, logging the count only', async () => {
      const legacySeed = generateMfaSecret();
      secrets.push(legacySeed);
      await staffUser('legacy', legacySeed);
      await staffUser('valid-v1', encryptMfaSecret(generateMfaSecret()));
      const listen = vi.spyOn(app, 'listen');

      const err = await startServer(app, opts(true)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MfaStartupBlockedError);
      expect((err as MfaStartupBlockedError).pendingMfaUpgrades).toBe(1);
      expect(listen).not.toHaveBeenCalled();
      expect(app.server.listening).toBe(false);

      const fatal = logged().find((l) => l.level === 'fatal');
      expect(fatal).toMatchObject({ pendingMfaUpgrades: 1 });
      expect(String(fatal!.msg)).toMatch(/refusing to start in production/);
    });

    it('6. production startup refuses to listen when the MFA safety check itself cannot run (not treated as zero)', async () => {
      const unreachable = new PrismaClient({
        datasources: { db: { url: 'postgresql://fcp_app:fcp_dev_password@localhost:5432/fcp_mfa_check_no_such_db' } },
      });
      const listen = vi.spyOn(app, 'listen');
      try {
        const err = await startServer(app, { ...opts(true), prisma: unreachable }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(MfaStartupBlockedError);
        expect((err as MfaStartupBlockedError).pendingMfaUpgrades).toBeNull();
        expect((err as Error).message).toMatch(/could not be performed/);
        expect(listen).not.toHaveBeenCalled();
        expect(app.server.listening).toBe(false);
      } finally {
        await unreachable.$disconnect();
      }
    });

    it('7. production startup proceeds when every stored MFA secret is valid v1', async () => {
      await staffUser('valid-v1-a', encryptMfaSecret(generateMfaSecret()));
      await staffUser('valid-v1-b', encryptMfaSecret(generateMfaSecret()));
      await staffUser('no-mfa', null);

      await startServer(app, opts(true));
      expect(app.server.listening).toBe(true);
    });

    it('development keeps the warning behaviour for pending rows and still listens', async () => {
      const legacySeed = generateMfaSecret();
      secrets.push(legacySeed);
      await staffUser('legacy', legacySeed);
      await startServer(app, opts(false));
      expect(app.server.listening).toBe(true);
      expect(logged().find((l) => l.level === 'warn' && 'pendingMfaUpgrades' in l)).toMatchObject({ pendingMfaUpgrades: 1 });
    });

    it('development warns (never reads zero) when the safety check fails, and still listens', async () => {
      const unreachable = new PrismaClient({
        datasources: { db: { url: 'postgresql://fcp_app:fcp_dev_password@localhost:5432/fcp_mfa_check_no_such_db' } },
      });
      try {
        await startServer(app, { ...opts(false), prisma: unreachable });
        expect(app.server.listening).toBe(true);
        const warn = logged().find((l) => l.level === 'warn' && l.msg === 'MFA migration safety check could not be performed');
        expect(warn).toBeDefined();
        expect(typeof warn!.reason).toBe('string');
      } finally {
        await unreachable.$disconnect();
      }
    });

    it('8. no MFA seed or stored value appears in startup logs or errors', async () => {
      const legacySeed = generateMfaSecret();
      const v1 = encryptMfaSecret(generateMfaSecret());
      secrets.push(legacySeed, v1);
      await staffUser('legacy', legacySeed);
      await staffUser('valid-v1', v1);
      const err = await startServer(app, opts(true)).catch((e: unknown) => e);
      const haystack = `${logLines.join('\n')}\n${(err as Error).message}\n${(err as Error).stack ?? ''}`;
      expect(logLines.length).toBeGreaterThan(0);
      for (const secret of secrets) expect(haystack.includes(secret), 'secret leaked into startup output').toBe(false);
    });
  });
});
