import { DatabaseError } from '../errors/DatabaseError.js';

/**
 * Assert that a repository identifier is a positive safe integer.
 *
 * @param {unknown} value
 * @param {string} name
 */
export function assertIdentifier(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

/**
 * Convert a SQLite integer flag to a JavaScript boolean.
 *
 * @param {number} value
 * @returns {boolean}
 */
export function fromDatabaseBoolean(value) {
  return value === 1;
}

/**
 * Convert a JavaScript boolean to a SQLite integer flag.
 *
 * @param {boolean} value
 * @returns {0 | 1}
 */
export function toDatabaseBoolean(value) {
  return value ? 1 : 0;
}

/**
 * Return a stable server timestamp.
 *
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Wrap an unexpected SQLite failure in the application's typed database error.
 *
 * @param {string} message
 * @param {unknown} error
 * @returns {never}
 */
export function throwDatabaseError(message, error) {
  if (error instanceof DatabaseError) {
    throw error;
  }

  throw new DatabaseError(message, { cause: error });
}

/**
 * Return whether better-sqlite3 reported a unique-constraint failure.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isUniqueConstraintError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT_UNIQUE')
  );
}
