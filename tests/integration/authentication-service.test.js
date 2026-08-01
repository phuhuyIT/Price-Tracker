import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { createPasswordHasher } from '../../apps/server/src/security/passwordHasher.js';
import { hashSessionToken } from '../../apps/server/src/security/sessionTokens.js';
import { createAuthenticationService } from '../../apps/server/src/services/authenticationService.js';
import { createTestDatabase } from './databaseTestUtils.js';

const TEST_SCRYPT_PARAMETERS = Object.freeze({
  keyLength: 32,
  maxmem: 16 * 1024 * 1024,
  N: 2 ** 10,
  p: 1,
  r: 8,
  saltLength: 16,
});
const STRONG_PASSWORD = 'Mật khẩu dài và riêng biệt 2026!';

let harness;
let currentTime;

function createService(authConfig = {}) {
  return createAuthenticationService({
    authConfig: {
      allowRegistration: true,
      enabled: true,
      sessionTtlHours: 2,
      ...authConfig,
    },
    clock: () => new Date(currentTime),
    passwordHasher: createPasswordHasher({ parameters: TEST_SCRYPT_PARAMETERS }),
    repositories: harness.repositories,
  });
}

beforeEach(() => {
  harness = createTestDatabase();
  currentTime = '2026-08-01T01:00:00.000Z';
});

afterEach(() => {
  harness.cleanup();
});

describe('authentication service', () => {
  it('registers, logs in, resolves, and revokes opaque application sessions', async () => {
    const service = createService();
    const registration = await service.register({
      clientType: 'dashboard',
      email: 'Owner@Example.com',
      password: STRONG_PASSWORD,
    });
    const storedUser = harness.repositories.users.findByEmail('owner@example.com');
    const storedRegistrationSession = harness.repositories.sessions.findByTokenHash(
      hashSessionToken(registration.sessionToken),
    );

    expect(registration).toMatchObject({
      session: { clientType: 'dashboard', transport: 'cookie' },
      user: { email: 'owner@example.com' },
    });
    expect(storedUser.passwordHash).toMatch(/^scrypt-v1\$/u);
    expect(storedUser.passwordHash).not.toContain(STRONG_PASSWORD);
    expect(storedRegistrationSession.tokenHash).not.toContain(registration.sessionToken);

    currentTime = '2026-08-01T01:30:00.000Z';
    const login = await service.login({
      clientType: 'extension',
      email: 'OWNER@example.com',
      password: STRONG_PASSWORD,
    });
    expect(login.session).toMatchObject({ clientType: 'extension', transport: 'bearer' });

    const credential = {
      clientType: 'extension',
      token: login.sessionToken,
      transport: 'bearer',
    };
    expect(service.getCurrentUser(credential)).toMatchObject({
      session: { lastSeenAt: currentTime },
      user: { id: storedUser.id },
    });
    expect(service.logout(credential)).toEqual({ loggedOut: true });
    expect(() => service.getCurrentUser(credential)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.SESSION_REVOKED }),
    );
  });

  it('rejects common passwords, invalid credentials, and expired sessions', async () => {
    const service = createService({ sessionTtlHours: 1 });

    await expect(
      service.register({
        clientType: 'dashboard',
        email: 'weak@example.com',
        password: 'passwordpassword',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.WEAK_PASSWORD });
    await expect(
      service.login({
        clientType: 'dashboard',
        email: 'missing@example.com',
        password: STRONG_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS });

    const registration = await service.register({
      clientType: 'dashboard',
      email: 'owner@example.com',
      password: STRONG_PASSWORD,
    });
    currentTime = '2026-08-01T02:00:00.000Z';

    expect(() =>
      service.getCurrentUser({
        clientType: 'dashboard',
        token: registration.sessionToken,
        transport: 'cookie',
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.SESSION_EXPIRED }));
  });

  it('resolves one reserved owner while authentication is disabled', async () => {
    const service = createService({ allowRegistration: false, enabled: false });
    const first = service.resolveOwner();
    const second = service.resolveOwner();

    expect(first.id).toBe(second.id);
    expect(first.email).toBe('local-user@shopee-price-tracker.invalid');
    await expect(
      service.register({
        clientType: 'dashboard',
        email: 'owner@example.com',
        password: STRONG_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.AUTH_DISABLED });
  });

  it('keeps registration separately disabled when authentication is enabled', async () => {
    const service = createService({ allowRegistration: false });

    await expect(
      service.register({
        clientType: 'dashboard',
        email: 'owner@example.com',
        password: STRONG_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.REGISTRATION_DISABLED });
  });
});
