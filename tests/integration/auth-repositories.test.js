import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { RESERVED_LOCAL_USER_EMAIL } from '../../apps/server/src/repositories/userRepository.js';
import { createTestDatabase, createTestOwner } from './databaseTestUtils.js';

let harness;

beforeEach(() => {
  harness = createTestDatabase();
});

afterEach(() => {
  harness.cleanup();
});

describe('user repository', () => {
  it('creates the reserved local owner exactly once', () => {
    const first = harness.repositories.users.ensureReservedLocalUser({
      createdAt: '2026-07-31T01:00:00.000Z',
    });
    const second = harness.repositories.users.ensureReservedLocalUser({
      createdAt: '2026-07-31T02:00:00.000Z',
    });

    expect(first).toMatchObject({
      email: RESERVED_LOCAL_USER_EMAIL,
      isReserved: true,
      passwordHash: null,
    });
    expect(second.id).toBe(first.id);
  });

  it('normalises emails and rejects duplicate account identities', () => {
    const user = createTestOwner(harness.repositories, 'Owner@Example.com');

    expect(user.email).toBe('owner@example.com');
    expect(harness.repositories.users.findByEmail('OWNER@example.com')?.id).toBe(user.id);

    expect(() => createTestOwner(harness.repositories, 'owner@example.com')).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.USER_EMAIL_EXISTS,
        statusCode: 409,
      }),
    );
  });
});

describe('session repository', () => {
  it('creates, expires, touches, and revokes hashed sessions', () => {
    const user = createTestOwner(harness.repositories);
    const session = harness.repositories.sessions.create({
      clientType: 'extension',
      createdAt: '2026-07-31T01:00:00.000Z',
      expiresAt: '2026-07-31T03:00:00.000Z',
      tokenHash: 'sha256:test-session-token-hash',
      transport: 'bearer',
      userId: user.id,
    });

    expect(
      harness.repositories.sessions.findActiveByTokenHash(
        session.tokenHash,
        '2026-07-31T02:00:00.000Z',
      ),
    ).toMatchObject({ id: session.id, revokedAt: null });
    expect(
      harness.repositories.sessions.findActiveByTokenHash(
        session.tokenHash,
        '2026-07-31T03:00:00.000Z',
      ),
    ).toBeNull();

    const touched = harness.repositories.sessions.touch({
      lastSeenAt: '2026-07-31T02:30:00.000Z',
      sessionId: session.id,
      userId: user.id,
    });
    expect(touched.lastSeenAt).toBe('2026-07-31T02:30:00.000Z');

    const revoked = harness.repositories.sessions.revoke({
      revokedAt: '2026-07-31T02:45:00.000Z',
      sessionId: session.id,
      userId: user.id,
    });
    expect(revoked.revokedAt).toBe('2026-07-31T02:45:00.000Z');
    expect(
      harness.repositories.sessions.findActiveByTokenHash(
        session.tokenHash,
        '2026-07-31T02:50:00.000Z',
      ),
    ).toBeNull();
    expect(harness.repositories.sessions.findByTokenHash(session.tokenHash)).toMatchObject({
      id: session.id,
      revokedAt: revoked.revokedAt,
    });
  });

  it('enforces the documented client and transport pairing in SQLite', () => {
    const user = createTestOwner(harness.repositories);

    expect(() =>
      harness.repositories.sessions.create({
        clientType: 'dashboard',
        createdAt: '2026-07-31T01:00:00.000Z',
        expiresAt: '2026-07-31T03:00:00.000Z',
        tokenHash: 'sha256:invalid-session-pair',
        transport: 'bearer',
        userId: user.id,
      }),
    ).toThrow(
      expect.objectContaining({
        code: ERROR_CODES.DATABASE_ERROR,
      }),
    );
  });
});
