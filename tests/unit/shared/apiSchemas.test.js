import { describe, expect, it } from 'vitest';

import {
  apiErrorResponseSchema,
  collectionJobClaimRequestSchema,
  collectionJobRebindRequestSchema,
  createSuccessResponseSchema,
  productHistoryQuerySchema,
  productIdParamsSchema,
  productListQuerySchema,
  trackProductRequestSchema,
  updateProductRequestSchema,
} from '../../../packages/shared/index.js';

describe('API request schemas', () => {
  it('accepts a Shopee tracking URL but rejects unrelated fields', () => {
    const request = {
      url: 'https://shopee.vn/product-i.1259293184.26882883164?source=dashboard',
    };

    expect(trackProductRequestSchema.safeParse(request).success).toBe(true);
    expect(
      trackProductRequestSchema.safeParse({
        ...request,
        cookie: 'must-not-be-accepted',
      }).success,
    ).toBe(false);
  });

  it('parses positive product IDs and rejects malformed IDs', () => {
    expect(productIdParamsSchema.parse({ productId: '42' })).toEqual({
      productId: 42,
    });
    expect(productIdParamsSchema.safeParse({ productId: '0' }).success).toBe(false);
    expect(productIdParamsSchema.safeParse({ productId: '1 OR 1=1' }).success).toBe(false);
  });

  it('accepts an optional positive targeted collection job ID', () => {
    const request = {
      jobId: 42,
      pricingContextKey: 'extension:test-profile',
      resumeWaitingAuth: true,
    };

    expect(collectionJobClaimRequestSchema.parse(request)).toEqual(request);
    expect(collectionJobClaimRequestSchema.safeParse({ ...request, jobId: 0 }).success).toBe(false);
  });

  it('accepts only an opaque pricing context for manual job reassignment', () => {
    const request = { pricingContextKey: 'extension:current-profile' };

    expect(collectionJobRebindRequestSchema.parse(request)).toEqual(request);
    expect(
      collectionJobRebindRequestSchema.safeParse({ ...request, cookie: 'not-allowed' }).success,
    ).toBe(false);
  });

  it('applies bounded pagination defaults', () => {
    expect(productListQuerySchema.parse({})).toEqual({
      limit: 20,
      page: 1,
    });
    expect(productListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('validates and normalises watchlist search filters', () => {
    expect(
      productListQuerySchema.parse({
        availability: 'sold_out',
        search: '  coffee pack  ',
        status: 'paused',
      }),
    ).toEqual({
      availability: 'sold_out',
      limit: 20,
      page: 1,
      search: 'coffee pack',
      status: 'paused',
    });
    expect(productListQuerySchema.parse({ search: '   ' })).toEqual({ limit: 20, page: 1 });
    expect(productListQuerySchema.safeParse({ availability: 'in_stock' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ search: 'x'.repeat(201) }).success).toBe(false);
  });

  it('validates history range and filters', () => {
    expect(
      productHistoryQuerySchema.safeParse({
        from: '2026-07-01T00:00:00.000Z',
        limit: '50',
        to: '2026-07-30T00:00:00.000Z',
        variantId: '4',
      }).success,
    ).toBe(true);
    expect(
      productHistoryQuerySchema.safeParse({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-07-30T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('requires at least one supported product update', () => {
    expect(updateProductRequestSchema.safeParse({ status: 'paused' }).success).toBe(true);
    expect(
      updateProductRequestSchema.safeParse({
        alertThresholdPercent: 2.5,
        status: 'active',
      }).success,
    ).toBe(true);
    expect(updateProductRequestSchema.safeParse({}).success).toBe(false);
    expect(updateProductRequestSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('API response schemas', () => {
  it('builds a strict success response schema', () => {
    const schema = createSuccessResponseSchema(productIdParamsSchema);

    expect(
      schema.safeParse({
        data: { productId: '2' },
        success: true,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        data: { productId: '2' },
        debug: true,
        success: true,
      }).success,
    ).toBe(false);
  });

  it('accepts only stable application error codes', () => {
    expect(
      apiErrorResponseSchema.safeParse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
        },
        success: false,
      }).success,
    ).toBe(true);
    expect(
      apiErrorResponseSchema.safeParse({
        error: {
          code: 'RANDOM_ERROR',
          message: 'Invalid request',
        },
        success: false,
      }).success,
    ).toBe(false);
  });
});
