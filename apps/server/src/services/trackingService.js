import { createHash } from 'node:crypto';

import { ERROR_CODES, productSnapshotSchema } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';
import { createPriceComparisonService } from './priceComparisonService.js';
import { createProductQueryService } from './productQueryService.js';

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function invalidSnapshotError(result) {
  return new AppError({
    code: ERROR_CODES.INVALID_SHOPEE_PAYLOAD,
    details: result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path,
    })),
    message: 'The product snapshot is invalid',
    statusCode: 422,
  });
}

function omittedVariantReason({ applyEligibleMiss, snapshot, suspiciousMassDisappearance }) {
  if (applyEligibleMiss) {
    return 'missing_from_verified_complete_catalogue';
  }

  if (suspiciousMassDisappearance) {
    return 'suspicious_mass_disappearance';
  }

  if (snapshot.variantCoverage === 'partial') {
    return 'not_in_partial_catalogue';
  }

  if (snapshot.variantCoverage === 'unknown') {
    return 'not_in_unknown_catalogue';
  }

  return 'missing_lifecycle_not_eligible';
}

/**
 * Derive a deterministic product-scoped key for an exact snapshot replay.
 *
 * @param {object} validatedSnapshot
 * @returns {string}
 */
export function deriveSnapshotIdempotencyKey(validatedSnapshot) {
  return sha256(stableStringify(validatedSnapshot));
}

/**
 * Create transactional snapshot tracking and lifecycle business logic.
 *
 * @param {object} input
 * @param {() => Date} [input.clock]
 * @param {{massMissingConfirmations: number, maxMissingRatio: number, missingThreshold: number}} input.lifecycleConfig
 * @param {number} input.priceDropThresholdPercent
 * @param {object} input.repositories
 */
export function createTrackingService({
  clock = () => new Date(),
  lifecycleConfig,
  priceDropThresholdPercent,
  repositories,
}) {
  const priceComparisonService = createPriceComparisonService({ repositories });
  const productQueryService = createProductQueryService({ repositories });

  return Object.freeze({
    /**
     * Validate and atomically persist one normalised collector snapshot.
     *
     * @param {object} input
     * @param {number} input.ownerUserId
     * @param {unknown} input.snapshot
     */
    saveSnapshot({ ownerUserId, snapshot: unvalidatedSnapshot }) {
      const validation = productSnapshotSchema.safeParse(unvalidatedSnapshot);

      if (!validation.success) {
        throw invalidSnapshotError(validation);
      }

      const snapshot = validation.data;
      const checkedAt = clock().toISOString();
      const idempotencyKey = deriveSnapshotIdempotencyKey(snapshot);
      const transactionResult = repositories.transaction((transactionRepositories) => {
        const existingProduct = transactionRepositories.products.findByIdentity({
          itemId: snapshot.itemId,
          ownerUserId,
          platform: snapshot.platform,
          shopId: snapshot.shopId,
        });

        if (existingProduct) {
          const existingCheck = transactionRepositories.prices.findCheckByIdempotency({
            idempotencyKey,
            ownerUserId,
            productId: existingProduct.id,
          });

          if (existingCheck) {
            return {
              check: existingCheck,
              comparisons: [],
              created: false,
              productId: existingProduct.id,
            };
          }
        }

        let product = transactionRepositories.products.upsert({
          alertThresholdPercent: priceDropThresholdPercent,
          canonicalUrl: snapshot.canonicalUrl,
          currency: snapshot.currency,
          imageUrl: snapshot.imageUrl,
          itemId: snapshot.itemId,
          ownerUserId,
          platform: snapshot.platform,
          shopId: snapshot.shopId,
          title: snapshot.title,
          updatedAt: checkedAt,
        });
        const existingVariants = transactionRepositories.variants.listByProduct({
          ownerUserId,
          productId: product.id,
        });
        const knownNonInactiveVariants = existingVariants.filter(
          (variant) => variant.lifecycleStatus !== 'inactive',
        );
        const observedModelIds = new Set(snapshot.variants.map((variant) => variant.modelId));
        const missingNonInactiveVariants = knownNonInactiveVariants.filter(
          (variant) => !observedModelIds.has(variant.externalModelId),
        );
        const missingRatio =
          missingNonInactiveVariants.length / Math.max(knownNonInactiveVariants.length, 1);
        const suspiciousMassDisappearance =
          snapshot.lifecycleEligible &&
          missingNonInactiveVariants.length > 0 &&
          missingRatio > lifecycleConfig.maxMissingRatio;
        const observedVariantSetHash = suspiciousMassDisappearance
          ? sha256([...observedModelIds].sort().join('\n'))
          : null;
        const checkCreation = transactionRepositories.prices.createCheck({
          capturedAt: snapshot.capturedAt,
          checkedAt,
          coverageConfidence: snapshot.coverageConfidence,
          expectedVariantCount: snapshot.expectedVariantCount,
          idempotencyKey,
          lifecycleEligible: snapshot.lifecycleEligible,
          observedVariantCount: snapshot.observedVariantCount,
          observedVariantSetHash,
          ownerUserId,
          pricedVariantCount: snapshot.pricedVariantCount,
          pricingContext: snapshot.pricingContext,
          pricingContextKey: snapshot.pricingContextKey,
          productId: product.id,
          schemaVersion: snapshot.schemaVersion,
          source: snapshot.source,
          status: 'success',
          suspiciousMassDisappearance,
          variantCoverage: snapshot.variantCoverage,
        });

        let applyEligibleMisses = snapshot.lifecycleEligible;

        if (suspiciousMassDisappearance) {
          product = transactionRepositories.products.recordMassMissingCandidate({
            ownerUserId,
            productId: product.id,
            updatedAt: checkedAt,
            variantSetHash: observedVariantSetHash,
          });
          applyEligibleMisses =
            product.pendingMissingConfirmationCount >= lifecycleConfig.massMissingConfirmations;
        } else if (snapshot.lifecycleEligible && product.pendingMissingVariantSetHash !== null) {
          product = transactionRepositories.products.clearMassMissingCandidate({
            ownerUserId,
            productId: product.id,
            updatedAt: checkedAt,
          });
        }

        const comparisons = [];

        for (const snapshotVariant of snapshot.variants) {
          const upserted = transactionRepositories.variants.upsertPresent({
            availability: snapshotVariant.availability,
            externalModelId: snapshotVariant.modelId,
            identityType: snapshotVariant.identityType,
            name: snapshotVariant.name,
            ownerUserId,
            productId: product.id,
            seenAt: checkedAt,
          });
          const observation = snapshotVariant.priceObservation;

          transactionRepositories.prices.insertCheckResult({
            availability: snapshotVariant.availability,
            checkId: checkCreation.check.id,
            createdAt: checkedAt,
            lifecycleEligible: false,
            ownerUserId,
            presence: 'present',
            priceStatus: observation.status,
            reasonCode: observation.status === 'not_observed' ? observation.reason : null,
            variantId: upserted.variant.id,
            variantLifecycle: upserted.variant.lifecycleStatus,
          });

          if (observation.status === 'observed') {
            const priceInsertion = transactionRepositories.prices.insertPriceLog({
              availability: snapshotVariant.availability,
              checkId: checkCreation.check.id,
              currency: observation.currency,
              ownerUserId,
              priceAmount: observation.priceAmount,
              priceDefinition: observation.priceDefinition,
              priceSource: observation.priceSource,
              priceType: observation.priceType,
              pricingContext: snapshot.pricingContext,
              pricingContextKey: snapshot.pricingContextKey,
              recordedAt: checkedAt,
              shippingIncluded: observation.shippingIncluded,
              variantId: upserted.variant.id,
              voucherStatus: observation.voucherStatus,
            });

            comparisons.push({
              comparison: priceComparisonService.evaluate({
                currentPrice: priceInsertion.priceLog,
                isNewBaseline: upserted.wasReactivated,
                ownerUserId,
                thresholdPercent: product.alertThresholdPercent,
              }),
              price: priceInsertion.priceLog,
              variant: upserted.variant,
            });
          }
        }

        for (const existingVariant of existingVariants) {
          if (observedModelIds.has(existingVariant.externalModelId)) {
            continue;
          }

          const shouldApplyMiss =
            applyEligibleMisses && existingVariant.lifecycleStatus !== 'inactive';
          const updatedVariant = shouldApplyMiss
            ? transactionRepositories.variants.recordEligibleMiss({
                checkedAt,
                missingThreshold: lifecycleConfig.missingThreshold,
                ownerUserId,
                variantId: existingVariant.id,
              })
            : existingVariant;
          const presence = snapshot.lifecycleEligible ? 'absent' : 'unknown';

          transactionRepositories.prices.insertCheckResult({
            availability: 'unknown',
            checkId: checkCreation.check.id,
            createdAt: checkedAt,
            lifecycleEligible: shouldApplyMiss,
            ownerUserId,
            presence,
            priceStatus: 'not_observed',
            reasonCode: omittedVariantReason({
              applyEligibleMiss: shouldApplyMiss,
              snapshot,
              suspiciousMassDisappearance,
            }),
            variantId: existingVariant.id,
            variantLifecycle: updatedVariant.lifecycleStatus,
          });
        }

        product = transactionRepositories.products.recordSuccessfulCheck({
          checkedAt,
          ownerUserId,
          productId: product.id,
        });

        return {
          check: checkCreation.check,
          comparisons,
          created: true,
          productId: product.id,
        };
      });

      return {
        ...transactionResult,
        product: productQueryService.getProduct({
          ownerUserId,
          productId: transactionResult.productId,
        }),
      };
    },
  });
}
