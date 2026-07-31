import { AppError } from '../errors/AppError.js';
import { DatabaseError } from '../errors/DatabaseError.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import {
  assertIdentifier,
  fromDatabaseBoolean,
  isUniqueConstraintError,
  nowIso,
  throwDatabaseError,
} from './repositoryUtils.js';

export const RESERVED_LOCAL_USER_EMAIL = 'local-user@shopee-price-tracker.invalid';

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    createdAt: row.created_at,
    email: row.email,
    id: row.id,
    isReserved: fromDatabaseBoolean(row.is_reserved),
    passwordHash: row.password_hash,
    updatedAt: row.updated_at,
  };
}

/**
 * Create owner-identity persistence operations.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createUserRepository(database) {
  const insertUser = database.prepare(`
    INSERT INTO users (email, password_hash, is_reserved, created_at, updated_at)
    VALUES (@email, @passwordHash, 0, @createdAt, @createdAt)
    RETURNING *
  `);
  const insertReservedUser = database.prepare(`
    INSERT INTO users (email, password_hash, is_reserved, created_at, updated_at)
    VALUES (@email, NULL, 1, @createdAt, @createdAt)
    ON CONFLICT(email) DO NOTHING
  `);
  const findByEmailStatement = database.prepare(
    'SELECT * FROM users WHERE email = ? COLLATE NOCASE',
  );
  const findByIdStatement = database.prepare('SELECT * FROM users WHERE id = ?');

  return Object.freeze({
    /**
     * Insert a normal account user.
     *
     * @param {{createdAt?: string, email: string, passwordHash: string}} input
     */
    create({ createdAt = nowIso(), email, passwordHash }) {
      try {
        return mapUser(
          insertUser.get({
            createdAt,
            email: email.trim().toLowerCase(),
            passwordHash,
          }),
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new AppError({
            cause: error,
            code: ERROR_CODES.USER_EMAIL_EXISTS,
            message: 'A user with this email already exists',
            statusCode: 409,
          });
        }

        throwDatabaseError('Unable to create the user', error);
      }
    },

    /**
     * Ensure the single reserved local owner exists.
     *
     * @param {{createdAt?: string}} [input]
     */
    ensureReservedLocalUser({ createdAt = nowIso() } = {}) {
      try {
        insertReservedUser.run({
          createdAt,
          email: RESERVED_LOCAL_USER_EMAIL,
        });

        const user = mapUser(findByEmailStatement.get(RESERVED_LOCAL_USER_EMAIL));

        if (!user?.isReserved) {
          throw new DatabaseError('The reserved local-user identity is occupied');
        }

        return user;
      } catch (error) {
        throwDatabaseError('Unable to create the reserved local user', error);
      }
    },

    /**
     * Find a user by normalised email.
     *
     * @param {string} email
     */
    findByEmail(email) {
      try {
        return mapUser(findByEmailStatement.get(email.trim().toLowerCase()));
      } catch (error) {
        throwDatabaseError('Unable to find the user by email', error);
      }
    },

    /**
     * Find a user by internal ID.
     *
     * @param {number} userId
     */
    findById(userId) {
      assertIdentifier(userId, 'userId');

      try {
        return mapUser(findByIdStatement.get(userId));
      } catch (error) {
        throwDatabaseError('Unable to find the user', error);
      }
    },
  });
}
