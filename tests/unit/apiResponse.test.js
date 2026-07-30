import { describe, expect, it } from 'vitest';

import { AppError } from '../../apps/server/src/errors/AppError.js';
import {
  createErrorResponse,
  createSuccessResponse,
} from '../../apps/server/src/utils/apiResponse.js';

describe('API response utilities', () => {
  it('creates a standard success envelope', () => {
    expect(createSuccessResponse({ id: 1 })).toEqual({
      success: true,
      data: { id: 1 },
    });
  });

  it('creates a standard operational error envelope', () => {
    const error = new AppError({
      code: 'EXAMPLE_ERROR',
      details: { field: 'url' },
      message: 'Example failure',
      statusCode: 422,
    });

    expect(createErrorResponse(error)).toEqual({
      success: false,
      error: {
        code: 'EXAMPLE_ERROR',
        details: { field: 'url' },
        message: 'Example failure',
      },
    });
  });

  it('does not expose unexpected error details', () => {
    expect(createErrorResponse(new Error('sensitive failure'))).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });
});
