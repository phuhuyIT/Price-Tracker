import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

function validationDetails(error) {
  return error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path,
  }));
}

/**
 * Validate selected Express request components and retain only parsed values.
 *
 * @param {object} schemas
 * @param {import('zod').ZodTypeAny} [schemas.body]
 * @param {import('zod').ZodTypeAny} [schemas.params]
 * @param {import('zod').ZodTypeAny} [schemas.query]
 * @param {object} [errorOptions]
 * @param {string} [errorOptions.code]
 * @param {string} [errorOptions.message]
 * @param {number} [errorOptions.statusCode]
 */
export function validateRequest(
  schemas,
  {
    code = ERROR_CODES.VALIDATION_ERROR,
    message = 'The request is invalid',
    statusCode = 400,
  } = {},
) {
  return function requestValidation(request, _response, next) {
    const validated = {};

    for (const [component, schema] of Object.entries(schemas)) {
      const rawValue = component === 'body' && request.body === undefined ? {} : request[component];
      const result = schema.safeParse(rawValue);

      if (!result.success) {
        next(
          new AppError({
            code,
            details: validationDetails(result.error),
            message,
            statusCode,
          }),
        );
        return;
      }

      validated[component] = result.data;
    }

    request.validated = {
      ...request.validated,
      ...validated,
    };
    next();
  };
}
