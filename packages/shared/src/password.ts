import bcrypt from 'bcryptjs';

// bcryptjs (pure JS) is used instead of a native-addon hashing library
// (argon2/bcrypt) so the service builds reliably in constrained/sandboxed
// environments without a C++ toolchain. bcrypt's algorithm and cost factor
// remain a secure, industry-standard choice for password hashing.
const SALT_ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
