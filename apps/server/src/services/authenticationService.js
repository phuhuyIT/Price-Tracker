import {
  AUTH_CLIENT_TYPES,
  ERROR_CODES,
  loginRequestSchema,
  registrationRequestSchema,
  sessionRequestSchema,
  SESSION_TRANSPORTS,
} from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';
import { isCommonPassword } from '../security/commonPasswordDenylist.js';
import { createPasswordHasher } from '../security/passwordHasher.js';
import { generateSessionToken, hashSessionToken } from '../security/sessionTokens.js';

const TRANSPORT_BY_CLIENT = Object.freeze({
  [AUTH_CLIENT_TYPES.DASHBOARD]: SESSION_TRANSPORTS.COOKIE,
  [AUTH_CLIENT_TYPES.EXTENSION]: SESSION_TRANSPORTS.BEARER,
});

function validationError(result) {
  return new AppError({
    code: ERROR_CODES.VALIDATION_ERROR,
    details: result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path,
    })),
    message: 'Authentication input is invalid',
    statusCode: 400,
  });
}

function publicUser(user) {
  return {
    createdAt: user.createdAt,
    email: user.email,
    id: user.id,
  };
}

function publicSession(session) {
  return {
    clientType: session.clientType,
    expiresAt: session.expiresAt,
    id: session.id,
    lastSeenAt: session.lastSeenAt,
    transport: session.transport,
  };
}

function authError(code, message) {
  return new AppError({ code, message, statusCode: 401 });
}

function assertAuthenticationEnabled(authConfig) {
  if (!authConfig.enabled) {
    throw new AppError({
      code: ERROR_CODES.AUTH_DISABLED,
      message: 'Application authentication is disabled',
      statusCode: 403,
    });
  }
}

function parseTimestamp(value, fieldName) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${fieldName} must be a valid ISO timestamp`);
  }

  return timestamp;
}

/**
 * Create account and revocable-session business logic.
 *
 * Plaintext session tokens are returned once under the deliberately named
 * `sessionToken` field. HTTP adapters must put dashboard tokens in an HTTP-only
 * cookie and must never serialise that field in a dashboard response body.
 *
 * @param {object} input
 * @param {{allowRegistration: boolean, enabled: boolean, sessionTtlHours: number}} input.authConfig
 * @param {() => Date} [input.clock]
 * @param {ReturnType<typeof createPasswordHasher>} [input.passwordHasher]
 * @param {import('../repositories/index.js').createRepositories extends (...args: any[]) => infer R ? R : never} input.repositories
 */
export function createAuthenticationService({
  authConfig,
  clock = () => new Date(),
  passwordHasher = createPasswordHasher(),
  repositories,
}) {
  function nowIso() {
    return clock().toISOString();
  }

  function createSessionRecord(transactionRepositories, userId, clientType, createdAt) {
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(
      parseTimestamp(createdAt, 'createdAt') + authConfig.sessionTtlHours * 60 * 60 * 1000,
    ).toISOString();
    const session = transactionRepositories.sessions.create({
      clientType,
      createdAt,
      expiresAt,
      tokenHash: hashSessionToken(sessionToken),
      transport: TRANSPORT_BY_CLIENT[clientType],
      userId,
    });

    return { session, sessionToken };
  }

  function findCredentialSession(credential, currentTime) {
    const stored = repositories.sessions.findByTokenHash(hashSessionToken(credential.token));

    if (
      !stored ||
      stored.clientType !== credential.clientType ||
      stored.transport !== credential.transport
    ) {
      throw authError(
        ERROR_CODES.AUTHENTICATION_REQUIRED,
        'A valid application session is required',
      );
    }

    if (stored.revokedAt !== null) {
      throw authError(ERROR_CODES.SESSION_REVOKED, 'The application session has been revoked');
    }

    if (parseTimestamp(stored.expiresAt, 'expiresAt') <= parseTimestamp(currentTime, 'now')) {
      throw authError(ERROR_CODES.SESSION_EXPIRED, 'The application session has expired');
    }

    return stored;
  }

  function getCurrentUser(credential) {
    assertAuthenticationEnabled(authConfig);
    const parsed = sessionRequestSchema.safeParse(credential);

    if (!parsed.success) {
      throw validationError(parsed);
    }

    const currentTime = nowIso();
    const storedSession = findCredentialSession(parsed.data, currentTime);
    const user = repositories.users.findById(storedSession.userId);

    if (!user || user.isReserved) {
      throw authError(
        ERROR_CODES.AUTHENTICATION_REQUIRED,
        'A valid application session is required',
      );
    }

    const session = repositories.sessions.touch({
      lastSeenAt: currentTime,
      sessionId: storedSession.id,
      userId: storedSession.userId,
    });

    return {
      session: publicSession(session),
      user: publicUser(user),
    };
  }

  return Object.freeze({
    /**
     * Return the current authenticated user and record session activity.
     *
     * @param {object} credential
     */
    getCurrentUser,

    /**
     * Verify credentials and create a new revocable application session.
     *
     * @param {object} input
     */
    async login(input) {
      assertAuthenticationEnabled(authConfig);
      const parsed = loginRequestSchema.safeParse(input);

      if (!parsed.success) {
        throw validationError(parsed);
      }

      const user = repositories.users.findByEmail(parsed.data.email);
      let credentialsMatch = false;

      if (user && !user.isReserved && user.passwordHash) {
        credentialsMatch = await passwordHasher.verify(parsed.data.password, user.passwordHash);
      } else {
        await passwordHasher.hash(parsed.data.password);
      }

      if (!credentialsMatch) {
        throw authError(ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is invalid');
      }

      const createdAt = nowIso();
      const { session, sessionToken } = createSessionRecord(
        repositories,
        user.id,
        parsed.data.clientType,
        createdAt,
      );

      return {
        session: publicSession(session),
        sessionToken,
        user: publicUser(user),
      };
    },

    /**
     * Revoke a session token. Repeating logout for the same valid token is safe.
     *
     * @param {object} credential
     */
    logout(credential) {
      assertAuthenticationEnabled(authConfig);
      const parsed = sessionRequestSchema.safeParse(credential);

      if (!parsed.success) {
        throw validationError(parsed);
      }

      const stored = repositories.sessions.findByTokenHash(hashSessionToken(parsed.data.token));

      if (
        !stored ||
        stored.clientType !== parsed.data.clientType ||
        stored.transport !== parsed.data.transport
      ) {
        throw authError(
          ERROR_CODES.AUTHENTICATION_REQUIRED,
          'A valid application session is required',
        );
      }

      repositories.sessions.revoke({
        revokedAt: nowIso(),
        sessionId: stored.id,
        userId: stored.userId,
      });

      return { loggedOut: true };
    },

    /**
     * Register a price-tracker account and create its first session.
     *
     * @param {object} input
     */
    async register(input) {
      assertAuthenticationEnabled(authConfig);

      if (!authConfig.allowRegistration) {
        throw new AppError({
          code: ERROR_CODES.REGISTRATION_DISABLED,
          message: 'Account registration is disabled',
          statusCode: 403,
        });
      }

      const parsed = registrationRequestSchema.safeParse(input);

      if (!parsed.success) {
        throw validationError(parsed);
      }

      if (isCommonPassword(parsed.data.password)) {
        throw new AppError({
          code: ERROR_CODES.WEAK_PASSWORD,
          message: 'Choose a password that is not common or previously compromised',
          statusCode: 400,
        });
      }

      const passwordHash = await passwordHasher.hash(parsed.data.password);
      const createdAt = nowIso();
      const result = repositories.transaction((transactionRepositories) => {
        const user = transactionRepositories.users.create({
          createdAt,
          email: parsed.data.email,
          passwordHash,
        });
        const { session, sessionToken } = createSessionRecord(
          transactionRepositories,
          user.id,
          parsed.data.clientType,
          createdAt,
        );

        return { session, sessionToken, user };
      });

      return {
        session: publicSession(result.session),
        sessionToken: result.sessionToken,
        user: publicUser(result.user),
      };
    },

    /**
     * Resolve the owner used by product operations in either authentication mode.
     *
     * @param {object} [credential]
     */
    resolveOwner(credential) {
      if (!authConfig.enabled) {
        return publicUser(repositories.users.ensureReservedLocalUser({ createdAt: nowIso() }));
      }

      return getCurrentUser(credential).user;
    },
  });
}
