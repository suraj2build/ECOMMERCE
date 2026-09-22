import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@fcp/shared';

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('CorrectHorseBattery1!');
    expect(await verifyPassword('CorrectHorseBattery1!', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('CorrectHorseBattery1!');
    expect(await verifyPassword('WrongPassword', hash)).toBe(false);
  });

  it('never stores the plaintext password in the hash output', async () => {
    const hash = await hashPassword('CorrectHorseBattery1!');
    expect(hash).not.toContain('CorrectHorseBattery1!');
  });
});
