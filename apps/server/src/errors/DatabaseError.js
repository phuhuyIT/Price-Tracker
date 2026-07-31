import { AppError } from './AppError.js';
import { ERROR_CODES } from './errorCodes.js';

/**
 * Operational error raised when SQLite persistence fails.
 */
export class DatabaseError extends AppError {
  /**
   * @param {string} message
   * @param {{cause?: unknown, details?: unknown}} [options]
   */
  constructor(message, { cause, details } = {}) {
    super({
      cause,
      code: ERROR_CODES.DATABASE_ERROR,
      details,
      message,
      statusCode: 500,
    });
  }
}
