import { z } from 'zod';

import { AVAILABILITY_STATUSES, PRODUCT_TRACKING_STATUSES } from '../constants/contractValues.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import { isoTimestampSchema, positiveSafeIntegerSchema } from './commonSchemas.js';
import { productSnapshotSchema } from './productSnapshotSchema.js';
import { shopeeProductUrlSchema } from './shopeeUrlSchema.js';

/**
 * Build a standard successful API-response schema for a specific data shape.
 *
 * @param {z.ZodTypeAny} dataSchema
 * @returns {z.ZodObject}
 */
export function createSuccessResponseSchema(dataSchema) {
  return z
    .object({
      data: dataSchema,
      meta: z.record(z.unknown()).optional(),
      success: z.literal(true),
    })
    .strict();
}

export const apiErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(Object.values(ERROR_CODES)),
        details: z.unknown().optional(),
        message: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    success: z.literal(false),
  })
  .strict();

export const trackProductRequestSchema = z
  .object({
    url: shopeeProductUrlSchema,
  })
  .strict();

export const productSnapshotRequestSchema = productSnapshotSchema;

export const emptyRequestBodySchema = z.object({}).strict();

export const productIdParamsSchema = z
  .object({
    productId: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .pipe(positiveSafeIntegerSchema),
  })
  .strict();

const positiveIntegerQuerySchema = z.coerce.number().int().positive().safe();
const optionalSearchQuerySchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).max(200).optional(),
);

export const productListQuerySchema = z
  .object({
    availability: z.enum(Object.values(AVAILABILITY_STATUSES)).optional(),
    limit: positiveIntegerQuerySchema.max(100).default(20),
    page: positiveIntegerQuerySchema.default(1),
    search: optionalSearchQuerySchema,
    status: z.enum(Object.values(PRODUCT_TRACKING_STATUSES)).optional(),
  })
  .strict();

export const productHistoryQuerySchema = z
  .object({
    from: isoTimestampSchema.optional(),
    limit: positiveIntegerQuerySchema.max(5_000).default(500),
    to: isoTimestampSchema.optional(),
    variantId: positiveIntegerQuerySchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'History "from" must not be after "to"',
        path: ['from'],
      });
    }
  });

export const updateProductRequestSchema = z
  .object({
    alertThresholdPercent: z.number().min(0).max(100).optional(),
    status: z.enum([PRODUCT_TRACKING_STATUSES.ACTIVE, PRODUCT_TRACKING_STATUSES.PAUSED]).optional(),
  })
  .strict()
  .refine(
    (request) => request.alertThresholdPercent !== undefined || request.status !== undefined,
    {
      message: 'At least one supported product setting is required',
    },
  );
