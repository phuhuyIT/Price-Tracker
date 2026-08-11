import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  createTestOwner,
  loadValidSnapshot,
  persistSnapshot,
} from './databaseTestUtils.js';

let harness;

beforeEach(() => {
  harness = createTestDatabase();
});

afterEach(() => {
  harness.cleanup();
});

function observedSnapshot({ amount, contextKey, capturedAt, source = 'extension' }) {
  const snapshot = loadValidSnapshot();
  snapshot.capturedAt = capturedAt;
  snapshot.pricingContext = source === 'extension' ? 'user_session' : 'anonymous';
  snapshot.pricingContextKey = contextKey;
  snapshot.source = source;
  snapshot.variants[0].priceObservation.priceAmount = amount;
  return snapshot;
}

describe('transactional snapshot persistence', () => {
  it('stores one product, grouped check, variants, one real price, and one gap', () => {
    const owner = createTestOwner(harness.repositories);
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });

    expect(stored.created).toBe(true);
    expect(harness.repositories.products.countByOwner(owner.id)).toBe(1);
    const variants = harness.repositories.variants.listByProduct({
      ownerUserId: owner.id,
      productId: stored.product.id,
    });
    expect(variants).toHaveLength(2);
    expect(variants[0].currentStockQuantity).toBe(12);

    const results = harness.repositories.prices.listCheckResults({
      checkId: stored.check.id,
      ownerUserId: owner.id,
    });
    const prices = harness.repositories.prices.listPriceLogsByCheck({
      checkId: stored.check.id,
      ownerUserId: owner.id,
    });

    expect(results).toHaveLength(2);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          presence: 'present',
          priceStatus: 'observed',
          reasonCode: null,
          stockQuantity: 12,
        }),
        expect.objectContaining({
          presence: 'present',
          priceStatus: 'not_observed',
          reasonCode: 'variation_response_missing',
        }),
      ]),
    );
    expect(prices).toEqual([
      expect.objectContaining({
        priceAmount: 199000,
        shippingIncluded: false,
      }),
    ]);
  });

  it('upserts a duplicate product, renames a stable variant, and inserts a new variant', () => {
    const owner = createTestOwner(harness.repositories);
    const first = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const firstVariantId = first.variants[0].id;
    const snapshot = loadValidSnapshot();

    snapshot.title = 'Updated product title';
    snapshot.capturedAt = '2026-07-31T03:00:00.000Z';
    snapshot.expectedVariantCount = 3;
    snapshot.observedVariantCount = 3;
    snapshot.pricedVariantCount = 2;
    snapshot.variants[0].name = 'Renamed stable model';
    snapshot.variants.push({
      availability: 'available',
      identityType: 'shopee_model',
      modelId: '280758809723',
      name: 'New model',
      priceObservation: {
        currency: 'VND',
        priceAmount: 299000,
        priceDefinition: 'displayed_post_voucher_excluding_shipping',
        priceSource: 'variation_price_breakdown',
        priceType: 'listed',
        shippingIncluded: false,
        status: 'observed',
        voucherStatus: 'not_applied',
      },
    });

    const second = persistSnapshot({
      checkedAt: '2026-07-31T03:01:00.000Z',
      idempotencyKey: 'snapshot-test-key-0002',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot,
    });

    expect(second.product.id).toBe(first.product.id);
    expect(harness.repositories.products.countByOwner(owner.id)).toBe(1);
    expect(second.variants).toHaveLength(3);
    expect(second.variants[0]).toMatchObject({
      id: firstVariantId,
      name: 'Renamed stable model',
    });
    expect(second.variants[2]).toMatchObject({
      externalModelId: '280758809723',
      lifecycleStatus: 'active',
    });
  });

  it('returns an existing check for a duplicate idempotency key without duplicate rows', () => {
    const owner = createTestOwner(harness.repositories);
    const first = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const duplicate = persistSnapshot({
      checkedAt: '2026-07-31T04:00:00.000Z',
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });

    expect(duplicate.created).toBe(false);
    expect(duplicate.check.id).toBe(first.check.id);
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get().count).toBe(
      1,
    );
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get().count).toBe(
      1,
    );

    expect(() =>
      harness.repositories.prices.createCheck({
        capturedAt: first.check.capturedAt,
        checkedAt: '2026-07-31T05:00:00.000Z',
        coverageConfidence: first.check.coverageConfidence,
        expectedVariantCount: first.check.expectedVariantCount,
        idempotencyKey: first.check.idempotencyKey,
        lifecycleEligible: first.check.lifecycleEligible,
        observedVariantCount: first.check.observedVariantCount,
        ownerUserId: owner.id,
        pricedVariantCount: first.check.pricedVariantCount,
        pricingContext: first.check.pricingContext,
        pricingContextKey: 'different_context_key',
        productId: first.product.id,
        schemaVersion: first.check.schemaVersion,
        source: first.check.source,
        status: first.check.status,
        variantCoverage: first.check.variantCoverage,
      }),
    ).toThrow(/idempotency key was reused with different data/u);
  });

  it('rolls back all writes when transaction work fails', () => {
    const owner = createTestOwner(harness.repositories);
    const snapshot = loadValidSnapshot();

    expect(() =>
      harness.repositories.transaction((repositories) => {
        const product = repositories.products.upsert({
          alertThresholdPercent: 1,
          canonicalUrl: snapshot.canonicalUrl,
          currency: snapshot.currency,
          imageUrl: snapshot.imageUrl,
          itemId: snapshot.itemId,
          ownerUserId: owner.id,
          platform: snapshot.platform,
          shopId: snapshot.shopId,
          title: snapshot.title,
          updatedAt: '2026-07-31T02:00:00.000Z',
        });
        const { variant } = repositories.variants.upsertPresent({
          availability: snapshot.variants[0].availability,
          externalModelId: snapshot.variants[0].modelId,
          identityType: snapshot.variants[0].identityType,
          name: snapshot.variants[0].name,
          ownerUserId: owner.id,
          productId: product.id,
          seenAt: '2026-07-31T02:00:00.000Z',
        });
        const { check } = repositories.prices.createCheck({
          capturedAt: snapshot.capturedAt,
          checkedAt: '2026-07-31T02:00:00.000Z',
          coverageConfidence: snapshot.coverageConfidence,
          expectedVariantCount: snapshot.expectedVariantCount,
          idempotencyKey: 'rollback-check-0001',
          lifecycleEligible: snapshot.lifecycleEligible,
          observedVariantCount: snapshot.observedVariantCount,
          ownerUserId: owner.id,
          pricedVariantCount: snapshot.pricedVariantCount,
          pricingContext: snapshot.pricingContext,
          pricingContextKey: snapshot.pricingContextKey,
          productId: product.id,
          schemaVersion: snapshot.schemaVersion,
          source: snapshot.source,
          status: 'success',
          variantCoverage: snapshot.variantCoverage,
        });
        repositories.prices.insertCheckResult({
          availability: variant.currentAvailability,
          checkId: check.id,
          createdAt: check.checkedAt,
          lifecycleEligible: false,
          ownerUserId: owner.id,
          presence: 'present',
          priceStatus: 'observed',
          variantId: variant.id,
          variantLifecycle: variant.lifecycleStatus,
        });
        repositories.prices.insertPriceLog({
          availability: variant.currentAvailability,
          checkId: check.id,
          currency: 'VND',
          ownerUserId: owner.id,
          priceAmount: 199000,
          priceDefinition: 'displayed_post_voucher_excluding_shipping',
          priceSource: 'variation_price_breakdown',
          priceType: 'listed',
          pricingContext: snapshot.pricingContext,
          pricingContextKey: snapshot.pricingContextKey,
          recordedAt: check.checkedAt,
          variantId: variant.id,
          voucherStatus: 'applied',
        });
        repositories.products.recordMassMissingCandidate({
          ownerUserId: owner.id,
          productId: product.id,
          updatedAt: check.checkedAt,
          variantSetHash: 'sha256:rollback-set',
        });
        throw new Error('forced transaction failure');
      }),
    ).toThrow('forced transaction failure');

    expect(harness.repositories.products.countByOwner(owner.id)).toBe(0);
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get().count).toBe(
      0,
    );
    expect(
      harness.database.prepare('SELECT COUNT(*) AS count FROM product_variants').get().count,
    ).toBe(0);
    expect(
      harness.database.prepare('SELECT COUNT(*) AS count FROM variant_check_results').get().count,
    ).toBe(0);
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get().count).toBe(
      0,
    );
  });

  it('rejects asynchronous work before committing the synchronous transaction', () => {
    const owner = createTestOwner(harness.repositories);
    const snapshot = loadValidSnapshot();

    expect(() =>
      harness.repositories.transaction((repositories) => {
        repositories.products.upsert({
          alertThresholdPercent: 1,
          canonicalUrl: snapshot.canonicalUrl,
          currency: snapshot.currency,
          imageUrl: snapshot.imageUrl,
          itemId: snapshot.itemId,
          ownerUserId: owner.id,
          platform: snapshot.platform,
          shopId: snapshot.shopId,
          title: snapshot.title,
          updatedAt: '2026-07-31T02:00:00.000Z',
        });

        return Promise.resolve();
      }),
    ).toThrow('Transaction work must be synchronous');
    expect(harness.repositories.products.countByOwner(owner.id)).toBe(0);
  });

  it('stores a failed extraction check without creating a price log', () => {
    const owner = createTestOwner(harness.repositories);
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const failure = harness.repositories.transaction((repositories) => {
      const checkCreation = repositories.prices.createCheck({
        checkedAt: '2026-07-31T05:00:00.000Z',
        errorCode: 'EXTRACTION_TIMEOUT',
        errorMessage: 'Shopee extraction timed out',
        idempotencyKey: 'failed-extraction-0001',
        ownerUserId: owner.id,
        pricingContext: 'anonymous',
        pricingContextKey: 'anonymous_context_01',
        productId: stored.product.id,
        source: 'playwright',
        status: 'failed',
      });
      const product = repositories.products.recordFailedCheck({
        checkedAt: checkCreation.check.checkedAt,
        errorCode: checkCreation.check.errorCode,
        errorMessage: checkCreation.check.errorMessage,
        ownerUserId: owner.id,
        productId: stored.product.id,
      });

      return { check: checkCreation.check, product };
    });

    expect(failure.check).toMatchObject({
      errorCode: 'EXTRACTION_TIMEOUT',
      lifecycleEligible: false,
      status: 'failed',
      variantCoverage: 'unknown',
    });
    expect(failure.product).toMatchObject({
      lastCheckedAt: '2026-07-31T05:00:00.000Z',
      lastErrorCode: 'EXTRACTION_TIMEOUT',
      lastSuccessAt: '2026-07-31T02:00:00.000Z',
    });
    expect(
      harness.repositories.prices.listPriceLogsByCheck({
        checkId: failure.check.id,
        ownerUserId: owner.id,
      }),
    ).toEqual([]);
  });
});

describe('variant lifecycle persistence', () => {
  it('keeps a present variant active when its price is not observed', () => {
    const owner = createTestOwner(harness.repositories);
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const unpricedVariant = stored.variants[1];

    expect(unpricedVariant).toMatchObject({
      consecutiveCompleteMisses: 0,
      currentAvailability: 'unknown',
      lifecycleStatus: 'active',
    });
    expect(
      harness.repositories.prices
        .listPriceLogsByCheck({
          checkId: stored.check.id,
          ownerUserId: owner.id,
        })
        .some((price) => price.variantId === unpricedVariant.id),
    ).toBe(false);
  });

  it('counts eligible misses, inactivates at the threshold, and reactivates on presence', () => {
    const owner = createTestOwner(harness.repositories);
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const variant = stored.variants[1];

    const firstMiss = harness.repositories.variants.recordEligibleMiss({
      checkedAt: '2026-08-01T01:00:00.000Z',
      missingThreshold: 3,
      ownerUserId: owner.id,
      variantId: variant.id,
    });
    const secondMiss = harness.repositories.variants.recordEligibleMiss({
      checkedAt: '2026-08-02T01:00:00.000Z',
      missingThreshold: 3,
      ownerUserId: owner.id,
      variantId: variant.id,
    });
    const thirdMiss = harness.repositories.variants.recordEligibleMiss({
      checkedAt: '2026-08-03T01:00:00.000Z',
      missingThreshold: 3,
      ownerUserId: owner.id,
      variantId: variant.id,
    });

    expect(firstMiss).toMatchObject({
      consecutiveCompleteMisses: 1,
      lifecycleStatus: 'suspected_missing',
      missingSince: '2026-08-01T01:00:00.000Z',
    });
    expect(secondMiss).toMatchObject({
      consecutiveCompleteMisses: 2,
      lifecycleStatus: 'suspected_missing',
    });
    expect(thirdMiss).toMatchObject({
      consecutiveCompleteMisses: 3,
      inactiveReason: 'missing_from_verified_complete_snapshots',
      lifecycleStatus: 'inactive',
    });

    const returning = harness.repositories.variants.upsertPresent({
      availability: 'unknown',
      externalModelId: variant.externalModelId,
      identityType: variant.identityType,
      name: 'Returned model',
      ownerUserId: owner.id,
      productId: stored.product.id,
      seenAt: '2026-08-04T01:00:00.000Z',
    });

    expect(returning.wasReactivated).toBe(true);
    expect(returning.variant).toMatchObject({
      consecutiveCompleteMisses: 0,
      inactiveReason: null,
      lifecycleStatus: 'active',
      missingSince: null,
      name: 'Returned model',
    });
  });

  it('leaves lifecycle neutral when a partial check omits the variant', () => {
    const owner = createTestOwner(harness.repositories);
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const variant = stored.variants[1];
    const firstMiss = harness.repositories.variants.recordEligibleMiss({
      checkedAt: '2026-08-01T01:00:00.000Z',
      missingThreshold: 3,
      ownerUserId: owner.id,
      variantId: variant.id,
    });
    const partialCheck = harness.repositories.prices.createCheck({
      capturedAt: '2026-08-02T01:00:00.000Z',
      checkedAt: '2026-08-02T01:00:01.000Z',
      coverageConfidence: 'partial',
      expectedVariantCount: null,
      idempotencyKey: 'partial-check-0001',
      lifecycleEligible: false,
      observedVariantCount: 1,
      ownerUserId: owner.id,
      pricedVariantCount: 1,
      pricingContext: 'user_session',
      pricingContextKey: 'extension_install_example_01',
      productId: stored.product.id,
      schemaVersion: 1,
      source: 'extension',
      status: 'success',
      variantCoverage: 'partial',
    });

    harness.repositories.prices.insertCheckResult({
      availability: 'unknown',
      checkId: partialCheck.check.id,
      createdAt: partialCheck.check.checkedAt,
      lifecycleEligible: false,
      ownerUserId: owner.id,
      presence: 'unknown',
      priceStatus: 'not_observed',
      reasonCode: 'not_in_partial_catalogue',
      variantId: variant.id,
      variantLifecycle: firstMiss.lifecycleStatus,
    });

    expect(
      harness.repositories.variants.findById({
        ownerUserId: owner.id,
        variantId: variant.id,
      }),
    ).toMatchObject({
      consecutiveCompleteMisses: 1,
      lifecycleStatus: 'suspected_missing',
      missingSince: firstMiss.missingSince,
    });
  });

  it('persists repeated-set mass-disappearance confirmation without changing misses itself', () => {
    const owner = createTestOwner(harness.repositories);
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const variant = stored.variants[1];
    const first = harness.repositories.products.recordMassMissingCandidate({
      ownerUserId: owner.id,
      productId: stored.product.id,
      updatedAt: '2026-08-01T01:00:00.000Z',
      variantSetHash: 'sha256:set-a',
    });
    const confirmed = harness.repositories.products.recordMassMissingCandidate({
      ownerUserId: owner.id,
      productId: stored.product.id,
      updatedAt: '2026-08-02T01:00:00.000Z',
      variantSetHash: 'sha256:set-a',
    });

    expect(first.pendingMissingConfirmationCount).toBe(1);
    expect(confirmed).toMatchObject({
      pendingMissingConfirmationCount: 2,
      pendingMissingVariantSetHash: 'sha256:set-a',
    });
    expect(
      harness.repositories.variants.findById({
        ownerUserId: owner.id,
        variantId: variant.id,
      }).consecutiveCompleteMisses,
    ).toBe(0);

    const confirmingMiss = harness.repositories.variants.recordEligibleMiss({
      checkedAt: '2026-08-02T01:00:00.000Z',
      missingThreshold: 3,
      ownerUserId: owner.id,
      variantId: variant.id,
    });
    expect(confirmingMiss.consecutiveCompleteMisses).toBe(1);

    const changedSet = harness.repositories.products.recordMassMissingCandidate({
      ownerUserId: owner.id,
      productId: stored.product.id,
      updatedAt: '2026-08-03T01:00:00.000Z',
      variantSetHash: 'sha256:set-b',
    });
    expect(changedSet.pendingMissingConfirmationCount).toBe(1);

    const cleared = harness.repositories.products.clearMassMissingCandidate({
      ownerUserId: owner.id,
      productId: stored.product.id,
      updatedAt: '2026-08-04T01:00:00.000Z',
    });
    expect(cleared).toMatchObject({
      pendingMissingConfirmationCount: 0,
      pendingMissingUpdatedAt: null,
      pendingMissingVariantSetHash: null,
    });
  });
});

describe('owner scope, history, notifications, and deletion', () => {
  it('isolates products and descendants between owners', () => {
    const owner = createTestOwner(harness.repositories, 'owner@example.com');
    const otherOwner = createTestOwner(harness.repositories, 'other-owner@example.com');
    const stored = persistSnapshot({
      ownerUserId: owner.id,
      repositories: harness.repositories,
    });
    const otherStored = persistSnapshot({
      idempotencyKey: 'other-owner-snapshot',
      ownerUserId: otherOwner.id,
      repositories: harness.repositories,
    });

    expect(otherStored.product.id).not.toBe(stored.product.id);
    expect(
      harness.repositories.products.findById({
        ownerUserId: otherOwner.id,
        productId: stored.product.id,
      }),
    ).toBeNull();
    expect(
      harness.repositories.variants.listByProduct({
        ownerUserId: otherOwner.id,
        productId: stored.product.id,
      }),
    ).toEqual([]);
    expect(
      harness.repositories.prices.listHistory({
        ownerUserId: otherOwner.id,
        productId: stored.product.id,
      }),
    ).toEqual([]);
    expect(
      harness.repositories.products.delete({
        ownerUserId: otherOwner.id,
        productId: stored.product.id,
      }),
    ).toBe(false);
  });

  it('keeps latest-price queries separated by pricing context and context key', () => {
    const owner = createTestOwner(harness.repositories);
    const userSession = persistSnapshot({
      checkedAt: '2026-07-31T02:00:00.000Z',
      idempotencyKey: 'context-user-session',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot: observedSnapshot({
        amount: 199000,
        capturedAt: '2026-07-31T01:59:00.000Z',
        contextKey: 'extension_context_01',
      }),
    });
    const anonymous = persistSnapshot({
      checkedAt: '2026-07-31T03:00:00.000Z',
      idempotencyKey: 'context-anonymous',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot: observedSnapshot({
        amount: 189000,
        capturedAt: '2026-07-31T02:59:00.000Z',
        contextKey: 'anonymous_context_01',
        source: 'playwright',
      }),
    });
    const variantId = userSession.variants[0].id;
    const definition = 'displayed_post_voucher_excluding_shipping';
    const source = 'variation_price_breakdown';

    expect(
      harness.repositories.prices.findLatestComparable({
        currency: 'VND',
        ownerUserId: owner.id,
        priceDefinition: definition,
        priceSource: source,
        priceType: 'listed',
        pricingContext: 'user_session',
        pricingContextKey: 'extension_context_01',
        variantId,
      }),
    ).toMatchObject({ priceAmount: 199000 });
    expect(
      harness.repositories.prices.findLatestComparable({
        currency: 'VND',
        ownerUserId: owner.id,
        priceDefinition: definition,
        priceSource: source,
        priceType: 'listed',
        pricingContext: 'anonymous',
        pricingContextKey: 'anonymous_context_01',
        variantId: anonymous.variants[0].id,
      }),
    ).toMatchObject({ priceAmount: 189000 });
    expect(
      harness.repositories.prices.listHistory({
        ownerUserId: owner.id,
        productId: userSession.product.id,
      }),
    ).toHaveLength(2);
  });

  it('deduplicates an exact successful price transition', () => {
    const owner = createTestOwner(harness.repositories);
    const first = persistSnapshot({
      checkedAt: '2026-07-31T02:00:00.000Z',
      idempotencyKey: 'notification-baseline',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot: observedSnapshot({
        amount: 250000,
        capturedAt: '2026-07-31T01:59:00.000Z',
        contextKey: 'extension_context_01',
      }),
    });
    const second = persistSnapshot({
      checkedAt: '2026-07-31T03:00:00.000Z',
      idempotencyKey: 'notification-drop',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot: observedSnapshot({
        amount: 199000,
        capturedAt: '2026-07-31T02:59:00.000Z',
        contextKey: 'extension_context_01',
      }),
    });
    const previousPrice = harness.repositories.prices.listPriceLogsByCheck({
      checkId: first.check.id,
      ownerUserId: owner.id,
    })[0];
    const currentPrice = harness.repositories.prices.listPriceLogsByCheck({
      checkId: second.check.id,
      ownerUserId: owner.id,
    })[0];
    const transition = {
      currency: 'VND',
      currentPriceLogId: currentPrice.id,
      newPriceAmount: currentPrice.priceAmount,
      oldPriceAmount: previousPrice.priceAmount,
      ownerUserId: owner.id,
      previousPriceLogId: previousPrice.id,
      priceDefinition: currentPrice.priceDefinition,
      priceType: currentPrice.priceType,
      pricingContext: currentPrice.pricingContext,
      pricingContextKey: currentPrice.pricingContextKey,
      variantId: second.variants[0].id,
    };

    const firstEvent = harness.repositories.notifications.recordSent(transition);
    const duplicate = harness.repositories.notifications.recordSent({
      ...transition,
      sentAt: '2026-07-31T04:00:00.000Z',
    });

    expect(firstEvent.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.notification.id).toBe(firstEvent.notification.id);
    expect(
      harness.repositories.notifications.findTransition({
        newPriceAmount: transition.newPriceAmount,
        oldPriceAmount: transition.oldPriceAmount,
        ownerUserId: owner.id,
        priceDefinition: transition.priceDefinition,
        priceType: transition.priceType,
        pricingContext: transition.pricingContext,
        pricingContextKey: transition.pricingContextKey,
        variantId: transition.variantId,
      }),
    ).toMatchObject({ id: firstEvent.notification.id });
  });

  it('cascade deletes all product history and successful notification events', () => {
    const owner = createTestOwner(harness.repositories);
    const first = persistSnapshot({
      checkedAt: '2026-07-31T02:00:00.000Z',
      idempotencyKey: 'cascade-baseline',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot: observedSnapshot({
        amount: 250000,
        capturedAt: '2026-07-31T01:59:00.000Z',
        contextKey: 'extension_context_01',
      }),
    });
    const second = persistSnapshot({
      checkedAt: '2026-07-31T03:00:00.000Z',
      idempotencyKey: 'cascade-drop',
      ownerUserId: owner.id,
      repositories: harness.repositories,
      snapshot: observedSnapshot({
        amount: 199000,
        capturedAt: '2026-07-31T02:59:00.000Z',
        contextKey: 'extension_context_01',
      }),
    });
    const previousPrice = harness.repositories.prices.listPriceLogsByCheck({
      checkId: first.check.id,
      ownerUserId: owner.id,
    })[0];
    const currentPrice = harness.repositories.prices.listPriceLogsByCheck({
      checkId: second.check.id,
      ownerUserId: owner.id,
    })[0];

    harness.repositories.notifications.recordSent({
      currency: 'VND',
      currentPriceLogId: currentPrice.id,
      newPriceAmount: currentPrice.priceAmount,
      oldPriceAmount: previousPrice.priceAmount,
      ownerUserId: owner.id,
      previousPriceLogId: previousPrice.id,
      priceDefinition: currentPrice.priceDefinition,
      priceType: currentPrice.priceType,
      pricingContext: currentPrice.pricingContext,
      pricingContextKey: currentPrice.pricingContextKey,
      variantId: second.variants[0].id,
    });

    expect(
      harness.repositories.products.delete({
        ownerUserId: owner.id,
        productId: first.product.id,
      }),
    ).toBe(true);

    for (const table of [
      'notification_events',
      'price_checks',
      'price_logs',
      'product_variants',
      'products',
      'variant_check_results',
    ]) {
      expect(harness.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(
        0,
      );
    }
  });
});
