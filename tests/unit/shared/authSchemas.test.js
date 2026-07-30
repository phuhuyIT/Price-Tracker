import { describe, expect, it } from 'vitest';

import {
  currentUserResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutRequestSchema,
  passwordSchema,
  registrationRequestSchema,
  sessionRequestSchema,
} from '../../../packages/shared/index.js';

const user = {
  createdAt: '2026-07-30T10:00:00.000Z',
  email: 'user@example.com',
  id: 1,
};

describe('authentication request schemas', () => {
  it.each([
    'mua-ca-phe-vao-thu-bay-2026',
    'Trời mưa nên tôi mua 2 túi cà phê!',
    'correct horse battery staple',
  ])('accepts a long passphrase: %s', (password) => {
    expect(passwordSchema.safeParse(password).success).toBe(true);
  });

  it.each(['short-password', 'PhuHuy123', 'a'.repeat(129)])(
    'rejects password outside the 15-128 character range',
    (password) => {
      expect(passwordSchema.safeParse(password).success).toBe(false);
    },
  );

  it('counts Unicode code points instead of UTF-16 units', () => {
    expect(passwordSchema.safeParse('😀'.repeat(14)).success).toBe(false);
    expect(passwordSchema.safeParse('😀'.repeat(15)).success).toBe(true);
  });

  it('rejects an all-whitespace password', () => {
    expect(passwordSchema.safeParse(' '.repeat(15)).success).toBe(false);
  });

  it('normalises email and retains spaces inside a passphrase', () => {
    const result = registrationRequestSchema.parse({
      clientType: 'dashboard',
      email: '  User@Example.COM ',
      password: 'correct horse battery staple',
    });

    expect(result.email).toBe('user@example.com');
    expect(result.password).toBe('correct horse battery staple');
  });

  it('requires an explicit supported client type', () => {
    expect(
      loginRequestSchema.safeParse({
        email: 'user@example.com',
        password: 'correct horse battery staple',
      }).success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({
        clientType: 'mobile',
        email: 'user@example.com',
        password: 'correct horse battery staple',
      }).success,
    ).toBe(false);
  });

  it('rejects extra credential fields', () => {
    expect(
      loginRequestSchema.safeParse({
        clientType: 'dashboard',
        email: 'user@example.com',
        password: 'correct horse battery staple',
        shopeeCookie: 'must-not-be-accepted',
      }).success,
    ).toBe(false);
  });

  it('defines logout as an empty body', () => {
    expect(logoutRequestSchema.safeParse({}).success).toBe(true);
    expect(logoutRequestSchema.safeParse({ token: 'body-token' }).success).toBe(false);
  });

  it('validates extracted cookie and bearer session credentials', () => {
    const token = 'a'.repeat(43);

    expect(
      sessionRequestSchema.safeParse({
        clientType: 'dashboard',
        token,
        transport: 'cookie',
      }).success,
    ).toBe(true);
    expect(
      sessionRequestSchema.safeParse({
        clientType: 'extension',
        token,
        transport: 'bearer',
      }).success,
    ).toBe(true);
    expect(
      sessionRequestSchema.safeParse({
        clientType: 'dashboard',
        token,
        transport: 'bearer',
      }).success,
    ).toBe(false);
  });
});

describe('authentication response schemas', () => {
  it('accepts dashboard cookie session metadata without exposing a token', () => {
    expect(
      loginResponseSchema.safeParse({
        data: {
          session: {
            clientType: 'dashboard',
            expiresAt: '2026-08-29T10:00:00.000Z',
            transport: 'cookie',
          },
          user,
        },
        success: true,
      }).success,
    ).toBe(true);
  });

  it('accepts an extension bearer session with an opaque token', () => {
    expect(
      loginResponseSchema.safeParse({
        data: {
          session: {
            clientType: 'extension',
            expiresAt: '2026-08-29T10:00:00.000Z',
            token: 'a'.repeat(43),
            transport: 'bearer',
          },
          user,
        },
        success: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a dashboard token and an extension session without a token', () => {
    const dashboardWithToken = {
      data: {
        session: {
          clientType: 'dashboard',
          expiresAt: '2026-08-29T10:00:00.000Z',
          token: 'a'.repeat(43),
          transport: 'cookie',
        },
        user,
      },
      success: true,
    };
    const extensionWithoutToken = structuredClone(dashboardWithToken);
    extensionWithoutToken.data.session = {
      clientType: 'extension',
      expiresAt: '2026-08-29T10:00:00.000Z',
      transport: 'bearer',
    };

    expect(loginResponseSchema.safeParse(dashboardWithToken).success).toBe(false);
    expect(loginResponseSchema.safeParse(extensionWithoutToken).success).toBe(false);
  });

  it('keeps raw tokens out of the current-user response', () => {
    const response = {
      data: {
        session: {
          clientType: 'extension',
          expiresAt: '2026-08-29T10:00:00.000Z',
          transport: 'bearer',
        },
        user,
      },
      success: true,
    };

    expect(currentUserResponseSchema.safeParse(response).success).toBe(true);

    response.data.session.token = 'a'.repeat(43);

    expect(currentUserResponseSchema.safeParse(response).success).toBe(false);
  });
});
