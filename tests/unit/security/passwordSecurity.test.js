import { describe, expect, it } from 'vitest';

import { isCommonPassword } from '../../../apps/server/src/security/commonPasswordDenylist.js';
import { createPasswordHasher } from '../../../apps/server/src/security/passwordHasher.js';
import {
  generateSessionToken,
  hashSessionToken,
} from '../../../apps/server/src/security/sessionTokens.js';

const TEST_SCRYPT_PARAMETERS = Object.freeze({
  keyLength: 32,
  maxmem: 16 * 1024 * 1024,
  N: 2 ** 10,
  p: 1,
  r: 8,
  saltLength: 16,
});

describe('password security', () => {
  it('hashes and verifies Unicode passwords with unique versioned salts', async () => {
    const hasher = createPasswordHasher({ parameters: TEST_SCRYPT_PARAMETERS });
    const password = 'Mật khẩu dài và riêng biệt 2026!';
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);

    expect(first).toMatch(/^scrypt-v1\$/u);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    await expect(hasher.verify(password, first)).resolves.toBe(true);
    await expect(hasher.verify('Mật khẩu không đúng 2026!', first)).resolves.toBe(false);
    await expect(hasher.verify(password, 'malformed-hash')).resolves.toBe(false);
  });

  it('rejects deterministic common and repeated passwords without network access', () => {
    expect(isCommonPassword('passwordpassword')).toBe(true);
    expect(isCommonPassword('Password_123456789')).toBe(true);
    expect(isCommonPassword('abcabcabcabcabc')).toBe(true);
    expect(isCommonPassword('Mật khẩu dài và riêng biệt 2026!')).toBe(false);
  });
});

describe('session-token security', () => {
  it('generates opaque tokens and persists only deterministic one-way hashes', () => {
    const token = generateSessionToken();
    const otherToken = generateSessionToken();
    const tokenHash = hashSessionToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(otherToken).not.toBe(token);
    expect(tokenHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(tokenHash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(tokenHash);
  });
});
