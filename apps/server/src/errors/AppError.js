import { ERROR_CODES } from './errorCodes.js';

/**
 * Operational application error with a stable public code and HTTP status.
 */
export class AppError extends Error {
  /**
   * @param {object} options
   * @param {string} options.code
   * @param {unknown} [options.details]
   * @param {string} options.message
   * @param {number} [options.statusCode]
   * @param {unknown} [options.cause]
   * @param {boolean} [options.isOperational]
   */
  constructor({
    cause,
    code = ERROR_CODES.INTERNAL_ERROR,
    details,
    isOperational = true,
    message,
    statusCode = 500,
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    this.statusCode = statusCode;
    Error.captureStackTrace?.(this, new.target);
  }
}
