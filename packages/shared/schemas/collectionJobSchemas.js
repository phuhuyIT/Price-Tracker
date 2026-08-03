import { z } from 'zod';

import { COLLECTION_JOB_STATUSES, COLLECTION_JOB_TYPES } from '../constants/contractValues.js';
import { ERROR_CODES } from '../errors/errorCodes.js';
import {
  isoTimestampSchema,
  positiveSafeIntegerSchema,
  pricingContextKeySchema,
  shopeeIdSchema,
} from './commonSchemas.js';
import { productSnapshotSchema } from './productSnapshotSchema.js';
import { canonicalShopeeProductUrlSchema } from './shopeeUrlSchema.js';

export const COLLECTION_JOB_FAILURE_CODES = Object.freeze([
  ERROR_CODES.AUTHENTICATION_REQUIRED,
  ERROR_CODES.COLLECTION_TIMEOUT,
  ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
  ERROR_CODES.PRODUCT_UNAVAILABLE,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.EXTENSION_UNAVAILABLE,
]);

export const collectionLeaseTokenSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, 'Expected a 256-bit hexadecimal lease token');

export const collectionJobIdParamsSchema = z
  .object({
    jobId: z
      .string()
      .regex(/^[1-9]\d*$/u)
      .transform(Number)
      .pipe(positiveSafeIntegerSchema),
  })
  .strict();

export const collectionJobClaimRequestSchema = z
  .object({ pricingContextKey: pricingContextKeySchema })
  .strict();

export const collectionJobCompleteRequestSchema = z
  .object({
    leaseToken: collectionLeaseTokenSchema,
    snapshot: productSnapshotSchema,
  })
  .strict();

export const collectionJobFailureRequestSchema = z
  .object({
    errorCode: z.enum(COLLECTION_JOB_FAILURE_CODES),
    errorMessage: z.string().trim().min(1).max(500),
    leaseToken: collectionLeaseTokenSchema,
  })
  .strict();

export const collectionJobSchema = z
  .object({
    canonicalUrl: canonicalShopeeProductUrlSchema,
    claimedContextKey: pricingContextKeySchema.nullable(),
    completedAt: isoTimestampSchema.nullable(),
    createdAt: isoTimestampSchema,
    errorCode: z.enum(COLLECTION_JOB_FAILURE_CODES).nullable(),
    errorMessage: z.string().max(500).nullable(),
    id: positiveSafeIntegerSchema,
    itemId: shopeeIdSchema,
    jobType: z.enum(Object.values(COLLECTION_JOB_TYPES)),
    leaseExpiresAt: isoTimestampSchema.nullable(),
    productId: positiveSafeIntegerSchema.nullable(),
    shopId: shopeeIdSchema,
    status: z.enum(Object.values(COLLECTION_JOB_STATUSES)),
    targetContextKey: pricingContextKeySchema.nullable(),
    updatedAt: isoTimestampSchema,
  })
  .strict();
