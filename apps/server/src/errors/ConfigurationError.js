import { AppError } from './AppError.js';
import { ERROR_CODES } from './errorCodes.js';

/**
 * Startup error produced by invalid environment configuration.
 */
export class ConfigurationError extends AppError {
  /**
   * @param {Array<{message: string, path: Array<string | number>}>} issues
   */
  constructor(issues) {
    const details = issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    super({
      code: ERROR_CODES.INVALID_CONFIGURATION,
      details,
      message: `Invalid application configuration: ${details
        .map(({ field, message }) => `${field || 'environment'}: ${message}`)
        .join('; ')}`,
      statusCode: 500,
    });
  }
}
