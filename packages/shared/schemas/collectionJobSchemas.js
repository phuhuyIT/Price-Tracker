import { z } from 'zod';

import {
  COLLECTION_JOB_SOURCES,
  COLLECTION_JOB_STATUSES,
  COLLECTION_JOB_TYPES,
} from '../constants/contractValues.js';
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
  ERROR_CODES.FETCH_FAILED,
  ERROR_CODES.INVALID_PRODUCT_URL,
  ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
  ERROR_CODES.NETWORK_TIMEOUT,
  ERROR_CODES.PRICE_SELECTOR_TIMEOUT,
  ERROR_CODES.PRODUCT_NOT_FOUND,
  ERROR_CODES.PRODUCT_UNAVAILABLE,
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.EXTENSION_UNAVAILABLE,
  ERROR_CODES.SCHEMA_PARSE_ERROR,
  ERROR_CODES.SHOPEE_SERVER_ERROR,
  ERROR_CODES.SHOP_SUSPENDED,
  ERROR_CODES.TAB_CLOSED_PREMATURELY,
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
  .object({
    jobId: positiveSafeIntegerSchema.optional(),
    pricingContextKey: pricingContextKeySchema,
    resumeWaitingAuth: z.boolean().optional().default(false),
  })
  .strict();

export const collectionJobRebindRequestSchema = z
  .object({
    pricingContextKey: pricingContextKeySchema,
  })
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
    jobSource: z.enum(Object.values(COLLECTION_JOB_SOURCES)),
    jobType: z.enum(Object.values(COLLECTION_JOB_TYPES)),
    leaseExpiresAt: isoTimestampSchema.nullable(),
    nextAttemptAt: isoTimestampSchema.nullable(),
    attemptCount: z.number().int().nonnegative().safe(),
    productId: positiveSafeIntegerSchema.nullable(),
    shopId: shopeeIdSchema,
    status: z.enum(Object.values(COLLECTION_JOB_STATUSES)),
    targetContextKey: pricingContextKeySchema.nullable(),
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const collectionJobQueueSummarySchema = z
  .object({
    claimed: z.number().int().nonnegative().safe(),
    pending: z.number().int().nonnegative().safe(),
    remaining: z.number().int().nonnegative().safe(),
    retryWait: z.number().int().nonnegative().safe(),
    waitingAuth: z.number().int().nonnegative().safe(),
  })
  .strict();

export const collectionJobQueueSchema = z
  .object({
    jobs: z.array(
      collectionJobSchema.extend({
        productTitle: z.string().trim().min(1).max(500).nullable(),
      }),
    ),
    summary: collectionJobQueueSummarySchema,
  })
  .strict()
  .superRefine((queue, context) => {
    const counted = {
      claimed: 0,
      pending: 0,
      retryWait: 0,
      waitingAuth: 0,
    };

    for (const job of queue.jobs) {
      const key =
        job.status === COLLECTION_JOB_STATUSES.RETRY_WAIT
          ? 'retryWait'
          : job.status === COLLECTION_JOB_STATUSES.WAITING_AUTH
            ? 'waitingAuth'
            : job.status;

      if (!(key in counted)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Collection-job queue contains a terminal job',
          path: ['jobs'],
        });
        continue;
      }

      counted[key] += 1;
    }

    for (const key of Object.keys(counted)) {
      if (queue.summary[key] !== counted[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Collection-job queue ${key} count does not match its jobs`,
          path: ['summary', key],
        });
      }
    }

    if (queue.summary.remaining !== queue.jobs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Collection-job queue remaining count does not match its jobs',
        path: ['summary', 'remaining'],
      });
    }
  });
