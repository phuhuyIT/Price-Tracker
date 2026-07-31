import { assertIdentifier, nowIso, throwDatabaseError } from './repositoryUtils.js';

function mapSession(row) {
  if (!row) {
    return null;
  }

  return {
    clientType: row.client_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    tokenHash: row.token_hash,
    transport: row.transport,
    userId: row.user_id,
  };
}

/**
 * Create revocable application-session persistence operations.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createSessionRepository(database) {
  const createStatement = database.prepare(`
    INSERT INTO user_sessions (
      user_id,
      token_hash,
      client_type,
      transport,
      created_at,
      expires_at
    )
    VALUES (
      @userId,
      @tokenHash,
      @clientType,
      @transport,
      @createdAt,
      @expiresAt
    )
    RETURNING *
  `);
  const findByHashStatement = database.prepare('SELECT * FROM user_sessions WHERE token_hash = ?');
  const findActiveByHashStatement = database.prepare(`
    SELECT *
    FROM user_sessions
    WHERE token_hash = @tokenHash
      AND revoked_at IS NULL
      AND expires_at > @now
  `);
  const revokeStatement = database.prepare(`
    UPDATE user_sessions
    SET revoked_at = COALESCE(revoked_at, @revokedAt)
    WHERE id = @sessionId AND user_id = @userId
    RETURNING *
  `);
  const touchStatement = database.prepare(`
    UPDATE user_sessions
    SET last_seen_at = @lastSeenAt
    WHERE id = @sessionId
      AND user_id = @userId
      AND revoked_at IS NULL
      AND expires_at > @lastSeenAt
    RETURNING *
  `);

  return Object.freeze({
    /**
     * Persist a one-way application session-token hash.
     *
     * @param {object} input
     * @param {'dashboard' | 'extension'} input.clientType
     * @param {string} [input.createdAt]
     * @param {string} input.expiresAt
     * @param {string} input.tokenHash
     * @param {'cookie' | 'bearer'} input.transport
     * @param {number} input.userId
     */
    create({ clientType, createdAt = nowIso(), expiresAt, tokenHash, transport, userId }) {
      assertIdentifier(userId, 'userId');

      try {
        return mapSession(
          createStatement.get({
            clientType,
            createdAt,
            expiresAt,
            tokenHash,
            transport,
            userId,
          }),
        );
      } catch (error) {
        throwDatabaseError('Unable to create the user session', error);
      }
    },

    /**
     * Find an active, unexpired session by token hash.
     *
     * @param {string} tokenHash
     * @param {string} [now]
     */
    findActiveByTokenHash(tokenHash, now = nowIso()) {
      try {
        return mapSession(findActiveByHashStatement.get({ now, tokenHash }));
      } catch (error) {
        throwDatabaseError('Unable to find the active user session', error);
      }
    },

    /**
     * Find a session regardless of expiry or revocation.
     *
     * @param {string} tokenHash
     */
    findByTokenHash(tokenHash) {
      try {
        return mapSession(findByHashStatement.get(tokenHash));
      } catch (error) {
        throwDatabaseError('Unable to find the user session', error);
      }
    },

    /**
     * Revoke a specific owner session.
     *
     * @param {object} input
     * @param {string} [input.revokedAt]
     * @param {number} input.sessionId
     * @param {number} input.userId
     */
    revoke({ revokedAt = nowIso(), sessionId, userId }) {
      assertIdentifier(sessionId, 'sessionId');
      assertIdentifier(userId, 'userId');

      try {
        return mapSession(revokeStatement.get({ revokedAt, sessionId, userId }));
      } catch (error) {
        throwDatabaseError('Unable to revoke the user session', error);
      }
    },

    /**
     * Record activity only for an active owner session.
     *
     * @param {object} input
     * @param {string} [input.lastSeenAt]
     * @param {number} input.sessionId
     * @param {number} input.userId
     */
    touch({ lastSeenAt = nowIso(), sessionId, userId }) {
      assertIdentifier(sessionId, 'sessionId');
      assertIdentifier(userId, 'userId');

      try {
        return mapSession(touchStatement.get({ lastSeenAt, sessionId, userId }));
      } catch (error) {
        throwDatabaseError('Unable to update the user session', error);
      }
    },
  });
}
