import { z } from 'zod';

import {
  COVERAGE_CONFIDENCE,
  PRICE_OBSERVATION_STATUS,
  PRODUCT_SNAPSHOT_SCHEMA_VERSION,
  PRICING_CONTEXTS,
  SNAPSHOT_SOURCES,
  VARIANT_COVERAGE,
  VARIANT_IDENTITY_TYPES,
  VARIANT_PRESENCE,
} from '../constants/contractValues.js';
import {
  httpsUrlSchema,
  isoTimestampSchema,
  nonNegativeSafeIntegerSchema,
  positivePriceAmountSchema,
  positiveSafeIntegerSchema,
  pricingContextKeySchema,
  reasonCodeSchema,
  shopeeIdSchema,
} from './commonSchemas.js';
import {
  availabilityStatusSchema,
  coverageConfidenceSchema,
  currencySchema,
  livePricingContextSchema,
  observedPriceSourceSchema,
  priceDefinitionSchema,
  priceTypeSchema,
  snapshotSourceSchema,
  variantCoverageSchema,
  variantIdentityTypeSchema,
  variantLifecycleSchema,
  variantPresenceSchema,
  voucherStatusSchema,
} from './enumSchemas.js';
import { canonicalShopeeProductUrlSchema, getShopeeProductIdentity } from './shopeeUrlSchema.js';

export const observedPriceObservationSchema = z
  .object({
    currency: currencySchema,
    priceAmount: positivePriceAmountSchema,
    priceDefinition: priceDefinitionSchema,
    priceSource: observedPriceSourceSchema,
    priceType: priceTypeSchema,
    shippingIncluded: z.literal(false),
    status: z.literal(PRICE_OBSERVATION_STATUS.OBSERVED),
    voucherStatus: voucherStatusSchema,
  })
  .strict();

export const notObservedPriceObservationSchema = z
  .object({
    reason: reasonCodeSchema,
    status: z.literal(PRICE_OBSERVATION_STATUS.NOT_OBSERVED),
  })
  .strict();

export const priceObservationSchema = z.discriminatedUnion('status', [
  observedPriceObservationSchema,
  notObservedPriceObservationSchema,
]);

export const productVariantSchema = z
  .object({
    availability: availabilityStatusSchema,
    identityType: variantIdentityTypeSchema,
    modelId: z.union([shopeeIdSchema, z.literal('default')]),
    name: z.string().trim().min(1).max(300),
    priceObservation: priceObservationSchema,
    stockQuantity: nonNegativeSafeIntegerSchema.nullable().default(null),
  })
  .strict()
  .superRefine((variant, context) => {
    const isDefault = variant.modelId === 'default';
    const isSynthetic = variant.identityType === VARIANT_IDENTITY_TYPES.SYNTHETIC_DEFAULT;

    if (isDefault !== isSynthetic) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The default model ID and synthetic-default identity type must be used together',
        path: ['identityType'],
      });
    }

    if (isDefault && variant.name !== 'Default') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The synthetic default variant name must be "Default"',
        path: ['name'],
      });
    }

    if (
      variant.stockQuantity !== null &&
      ((variant.stockQuantity === 0 && variant.availability !== 'sold_out') ||
        (variant.stockQuantity > 0 && variant.availability !== 'available'))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Known stock quantity must agree with variant availability',
        path: ['stockQuantity'],
      });
    }
  });

export const variantCatalogueCoverageFields = {
  coverageConfidence: coverageConfidenceSchema,
  expectedVariantCount: nonNegativeSafeIntegerSchema.nullable(),
  lifecycleEligible: z.boolean(),
  observedVariantCount: nonNegativeSafeIntegerSchema,
  pricedVariantCount: nonNegativeSafeIntegerSchema,
  variantCoverage: variantCoverageSchema,
};

/**
 * Determine whether catalogue evidence may affect missing-variant lifecycle.
 *
 * @param {{variantCoverage: string, coverageConfidence: string}} coverage
 * @returns {boolean}
 */
export function isLifecycleEligibleCoverage(coverage) {
  return (
    coverage.variantCoverage === VARIANT_COVERAGE.COMPLETE &&
    coverage.coverageConfidence === COVERAGE_CONFIDENCE.VERIFIED
  );
}

function addCoverageIssues(coverage, context) {
  const eligible = isLifecycleEligibleCoverage(coverage);

  if (coverage.lifecycleEligible !== eligible) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Lifecycle eligibility must be derived from complete, verified coverage',
      path: ['lifecycleEligible'],
    });
  }

  if (coverage.pricedVariantCount > coverage.observedVariantCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Priced variant count cannot exceed observed variant count',
      path: ['pricedVariantCount'],
    });
  }

  if (
    coverage.expectedVariantCount !== null &&
    coverage.expectedVariantCount < coverage.observedVariantCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected variant count cannot be lower than observed variant count',
      path: ['expectedVariantCount'],
    });
  }

  if (coverage.variantCoverage === VARIANT_COVERAGE.COMPLETE) {
    if (
      coverage.expectedVariantCount === null ||
      coverage.expectedVariantCount !== coverage.observedVariantCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Complete coverage requires equal expected and observed variant counts',
        path: ['expectedVariantCount'],
      });
    }

    if (
      ![COVERAGE_CONFIDENCE.VERIFIED, COVERAGE_CONFIDENCE.LIKELY_COMPLETE].includes(
        coverage.coverageConfidence,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Complete coverage requires verified or likely-complete confidence',
        path: ['coverageConfidence'],
      });
    }
  }

  if (
    coverage.variantCoverage === VARIANT_COVERAGE.PARTIAL &&
    coverage.coverageConfidence !== COVERAGE_CONFIDENCE.PARTIAL
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Partial coverage requires partial confidence',
      path: ['coverageConfidence'],
    });
  }

  if (
    coverage.variantCoverage === VARIANT_COVERAGE.UNKNOWN &&
    coverage.coverageConfidence !== COVERAGE_CONFIDENCE.UNKNOWN
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Unknown coverage requires unknown confidence',
      path: ['coverageConfidence'],
    });
  }
}

export const variantCatalogueCoverageSchema = z
  .object(variantCatalogueCoverageFields)
  .strict()
  .superRefine(addCoverageIssues);

export const productSnapshotSchema = z
  .object({
    canonicalUrl: canonicalShopeeProductUrlSchema,
    capturedAt: isoTimestampSchema,
    currency: currencySchema,
    imageUrl: httpsUrlSchema.nullable(),
    itemId: shopeeIdSchema,
    platform: z.literal('shopee'),
    pricingContext: livePricingContextSchema,
    pricingContextKey: pricingContextKeySchema,
    schemaVersion: z.literal(PRODUCT_SNAPSHOT_SCHEMA_VERSION),
    shopId: shopeeIdSchema,
    source: snapshotSourceSchema,
    title: z.string().trim().min(1).max(500),
    variants: z.array(productVariantSchema).min(1).max(10_000),
    ...variantCatalogueCoverageFields,
  })
  .strict()
  .superRefine((snapshot, context) => {
    addCoverageIssues(snapshot, context);

    const urlIdentity = getShopeeProductIdentity(snapshot.canonicalUrl);

    if (
      !urlIdentity ||
      urlIdentity.shopId !== snapshot.shopId ||
      urlIdentity.itemId !== snapshot.itemId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Canonical URL product IDs must match shopId and itemId',
        path: ['canonicalUrl'],
      });
    }

    if (
      (snapshot.source === SNAPSHOT_SOURCES.EXTENSION &&
        snapshot.pricingContext !== PRICING_CONTEXTS.USER_SESSION) ||
      (snapshot.source === SNAPSHOT_SOURCES.PLAYWRIGHT &&
        snapshot.pricingContext !== PRICING_CONTEXTS.ANONYMOUS)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Extension snapshots must be user-session; Playwright snapshots must be anonymous',
        path: ['pricingContext'],
      });
    }

    if (snapshot.observedVariantCount !== snapshot.variants.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Observed variant count must equal the variants array length',
        path: ['observedVariantCount'],
      });
    }

    const pricedVariantCount = snapshot.variants.filter(
      (variant) => variant.priceObservation.status === PRICE_OBSERVATION_STATUS.OBSERVED,
    ).length;

    if (snapshot.pricedVariantCount !== pricedVariantCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Priced variant count must equal the number of observed prices',
        path: ['pricedVariantCount'],
      });
    }

    const modelIds = snapshot.variants.map((variant) => variant.modelId);

    if (new Set(modelIds).size !== modelIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Variant model IDs must be unique within a snapshot',
        path: ['variants'],
      });
    }

    const defaultVariants = snapshot.variants.filter(
      (variant) => variant.identityType === VARIANT_IDENTITY_TYPES.SYNTHETIC_DEFAULT,
    );

    if (
      defaultVariants.length > 0 &&
      (snapshot.variants.length !== 1 ||
        !isLifecycleEligibleCoverage(snapshot) ||
        snapshot.expectedVariantCount !== 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A synthetic default variant requires one positively verified complete catalogue entry',
        path: ['variants'],
      });
    }

    snapshot.variants.forEach((variant, index) => {
      if (
        variant.priceObservation.status === PRICE_OBSERVATION_STATUS.OBSERVED &&
        variant.priceObservation.currency !== snapshot.currency
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Variant price currency must match the snapshot currency',
          path: ['variants', index, 'priceObservation', 'currency'],
        });
      }
    });
  });

export const variantCheckResultSchema = z
  .object({
    availability: availabilityStatusSchema,
    lifecycleEligible: z.boolean(),
    presence: variantPresenceSchema,
    priceStatus: z.enum(Object.values(PRICE_OBSERVATION_STATUS)),
    reasonCode: reasonCodeSchema.optional(),
    stockQuantity: nonNegativeSafeIntegerSchema.nullable().default(null),
    variantId: positiveSafeIntegerSchema,
    variantLifecycle: variantLifecycleSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.priceStatus === PRICE_OBSERVATION_STATUS.OBSERVED &&
      result.presence !== VARIANT_PRESENCE.PRESENT
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An observed price requires a present variant',
        path: ['presence'],
      });
    }

    if (result.priceStatus === PRICE_OBSERVATION_STATUS.NOT_OBSERVED && !result.reasonCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A not-observed check result requires a reason code',
        path: ['reasonCode'],
      });
    }

    if (
      result.priceStatus === PRICE_OBSERVATION_STATUS.OBSERVED &&
      result.reasonCode !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An observed check result cannot contain a failure reason',
        path: ['reasonCode'],
      });
    }

    if (result.lifecycleEligible && result.presence !== VARIANT_PRESENCE.ABSENT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only an absent variant may carry lifecycle-eligible missing evidence',
        path: ['lifecycleEligible'],
      });
    }

    if (result.presence !== VARIANT_PRESENCE.PRESENT && result.availability !== 'unknown') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An absent or unknown variant check cannot declare current availability',
        path: ['availability'],
      });
    }

    if (result.presence !== VARIANT_PRESENCE.PRESENT && result.stockQuantity !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An absent or unknown variant check cannot declare stock quantity',
        path: ['stockQuantity'],
      });
    }

    if (
      result.stockQuantity !== null &&
      ((result.stockQuantity === 0 && result.availability !== 'sold_out') ||
        (result.stockQuantity > 0 && result.availability !== 'available'))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Known stock quantity must agree with result availability',
        path: ['stockQuantity'],
      });
    }
  });
