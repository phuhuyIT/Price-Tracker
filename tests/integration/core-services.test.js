import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { createProductQueryService } from '../../apps/server/src/services/productQueryService.js';
import { createTrackingService } from '../../apps/server/src/services/trackingService.js';
import { createTestDatabase, createTestOwner, loadValidSnapshot } from './databaseTestUtils.js';

const LIFECYCLE_CONFIG = Object.freeze({
  massMissingConfirmations: 2,
  maxMissingRatio: 0.5,
  missingThreshold: 3,
});

let harness;
let currentTime;
let owner;
let productQueryService;
let trackingService;

function clone(value) {
  return structuredClone(value);
}

function setCapture(snapshot, sequence, source = 'extension') {
  snapshot.capturedAt = `2026-08-${String(sequence).padStart(2, '0')}T00:00:00.000Z`;
  snapshot.source = source;
  snapshot.pricingContext = source === 'extension' ? 'user_session' : 'anonymous';
  snapshot.pricingContextKey =
    source === 'extension' ? 'extension_context_01' : 'anonymous_context_01';
  return snapshot;
}

function observedVariant(modelId, priceAmount, overrides = {}) {
  return {
    availability: 'available',
    identityType: 'shopee_model',
    modelId,
    name: `Variant ${modelId}`,
    priceObservation: {
      currency: 'VND',
      priceAmount,
      priceDefinition: 'displayed_post_voucher_excluding_shipping',
      priceSource: 'variation_price_breakdown',
      priceType: 'listed',
      shippingIncluded: false,
      status: 'observed',
      voucherStatus: 'applied',
    },
    ...overrides,
  };
}

function completeSnapshot(variants, sequence, source = 'extension') {
  const snapshot = setCapture(loadValidSnapshot(), sequence, source);
  snapshot.variants = clone(variants);
  snapshot.expectedVariantCount = variants.length;
  snapshot.observedVariantCount = variants.length;
  snapshot.pricedVariantCount = variants.filter(
    (variant) => variant.priceObservation.status === 'observed',
  ).length;
  snapshot.variantCoverage = 'complete';
  snapshot.coverageConfidence = 'verified';
  snapshot.lifecycleEligible = true;
  return snapshot;
}

function partialSnapshot(variants, sequence) {
  const snapshot = completeSnapshot(variants, sequence);
  snapshot.expectedVariantCount = null;
  snapshot.variantCoverage = 'partial';
  snapshot.coverageConfidence = 'partial';
  snapshot.lifecycleEligible = false;
  return snapshot;
}

function notObservedVariant(variant, reason = 'variation_response_missing') {
  return {
    ...clone(variant),
    availability: 'unknown',
    priceObservation: {
      reason,
      status: 'not_observed',
    },
  };
}

function save(snapshot, checkedAt) {
  currentTime = checkedAt;
  return trackingService.saveSnapshot({ ownerUserId: owner.id, snapshot });
}

function comparisonFor(result, modelId) {
  return result.comparisons.find((entry) => entry.variant.externalModelId === modelId)?.comparison;
}

beforeEach(() => {
  harness = createTestDatabase();
  owner = createTestOwner(harness.repositories);
  currentTime = '2026-08-01T00:00:01.000Z';
  productQueryService = createProductQueryService({ repositories: harness.repositories });
  trackingService = createTrackingService({
    clock: () => new Date(currentTime),
    lifecycleConfig: LIFECYCLE_CONFIG,
    priceDropThresholdPercent: 1,
    repositories: harness.repositories,
  });
});

afterEach(() => {
  harness.cleanup();
});

describe('tracking and price-comparison services', () => {
  it('validates external snapshots before opening a persistence transaction', () => {
    const snapshot = loadValidSnapshot();
    snapshot.variants[0].priceObservation.priceAmount = 0;

    expect(() => save(snapshot, '2026-08-01T00:00:01.000Z')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INVALID_SHOPEE_PAYLOAD }),
    );
    expect(harness.repositories.products.countByOwner(owner.id)).toBe(0);
  });

  it('persists one initial baseline and ignores an exact replay', () => {
    const firstVariant = observedVariant('1001', 250_000);
    const snapshot = completeSnapshot([firstVariant], 1);
    const first = save(snapshot, '2026-08-01T00:00:01.000Z');
    const replay = save(snapshot, '2026-08-01T00:05:00.000Z');

    expect(first.created).toBe(true);
    expect(comparisonFor(first, '1001')).toMatchObject({
      reason: 'initial_baseline',
      shouldNotify: false,
    });
    expect(replay).toMatchObject({ created: false, check: { id: first.check.id } });
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_checks').get().count).toBe(
      1,
    );
    expect(harness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get().count).toBe(
      1,
    );
  });

  it('classifies unchanged, increased, below-threshold, and qualifying prices', () => {
    const modelId = '1001';
    save(completeSnapshot([observedVariant(modelId, 250_000)], 1), '2026-08-01T00:00:01.000Z');
    const unchanged = save(
      completeSnapshot([observedVariant(modelId, 250_000)], 2),
      '2026-08-02T00:00:01.000Z',
    );
    const increased = save(
      completeSnapshot([observedVariant(modelId, 260_000)], 3),
      '2026-08-03T00:00:01.000Z',
    );
    const belowThreshold = save(
      completeSnapshot([observedVariant(modelId, 259_000)], 4),
      '2026-08-04T00:00:01.000Z',
    );
    const qualifying = save(
      completeSnapshot([observedVariant(modelId, 199_000)], 5),
      '2026-08-05T00:00:01.000Z',
    );

    expect(comparisonFor(unchanged, modelId).reason).toBe('price_unchanged');
    expect(comparisonFor(increased, modelId).reason).toBe('price_increased');
    expect(comparisonFor(belowThreshold, modelId)).toMatchObject({
      reason: 'below_threshold',
      shouldNotify: false,
    });
    expect(comparisonFor(qualifying, modelId)).toMatchObject({
      dropPercentage: expect.any(Number),
      reason: 'qualifying_drop',
      shouldNotify: true,
    });
  });

  it('does not compare different contexts or price sources', () => {
    const modelId = '1001';
    save(completeSnapshot([observedVariant(modelId, 250_000)], 1), '2026-08-01T00:00:01.000Z');
    const anonymous = save(
      completeSnapshot([observedVariant(modelId, 150_000)], 2, 'playwright'),
      '2026-08-02T00:00:01.000Z',
    );
    const differentSourceVariant = observedVariant(modelId, 140_000);
    differentSourceVariant.priceObservation.priceSource = 'verified_display_field';
    const differentSource = save(
      completeSnapshot([differentSourceVariant], 3),
      '2026-08-03T00:00:01.000Z',
    );

    expect(comparisonFor(anonymous, modelId).reason).toBe('initial_baseline');
    expect(comparisonFor(differentSource, modelId).reason).toBe('initial_baseline');
  });

  it.each(['sold_out', 'unavailable'])(
    'stores but never alerts for an observed %s price',
    (availability) => {
      const modelId = '1001';
      save(completeSnapshot([observedVariant(modelId, 250_000)], 1), '2026-08-01T00:00:01.000Z');
      const unavailableVariant = observedVariant(modelId, 100_000, { availability });
      const result = save(completeSnapshot([unavailableVariant], 2), '2026-08-02T00:00:01.000Z');

      expect(comparisonFor(result, modelId)).toMatchObject({
        reason: 'unavailable_current_price',
        shouldNotify: false,
      });
      expect(
        harness.repositories.prices.listPriceLogsByCheck({
          checkId: result.check.id,
          ownerUserId: owner.id,
        }),
      ).toHaveLength(1);
      expect(result.product).toMatchObject({
        availability,
        currentLowestPrice: null,
        status: 'active',
        trackingStatus: 'active',
        variants: [
          expect.objectContaining({
            availability,
            lifecycleStatus: 'active',
            preferredPrice: expect.objectContaining({
              displayStatus: 'unavailable',
              isPurchasable: false,
            }),
          }),
        ],
      });
    },
  );

  it('allows voucher-status changes while still applying price-direction rules', () => {
    const modelId = '1001';
    save(completeSnapshot([observedVariant(modelId, 250_000)], 1), '2026-08-01T00:00:01.000Z');
    const voucherRemoved = observedVariant(modelId, 275_000);
    voucherRemoved.priceObservation.voucherStatus = 'not_applied';
    const result = save(completeSnapshot([voucherRemoved], 2), '2026-08-02T00:00:01.000Z');

    expect(comparisonFor(result, modelId)).toMatchObject({
      reason: 'price_increased',
      shouldNotify: false,
    });
  });

  it('suppresses a transition after that exact transition was successfully recorded', () => {
    const modelId = '1001';
    save(completeSnapshot([observedVariant(modelId, 250_000)], 1), '2026-08-01T00:00:01.000Z');
    const firstDrop = save(
      completeSnapshot([observedVariant(modelId, 199_000)], 2),
      '2026-08-02T00:00:01.000Z',
    );
    const transition = comparisonFor(firstDrop, modelId).transition;
    harness.repositories.notifications.recordSent(transition);
    save(completeSnapshot([observedVariant(modelId, 250_000)], 3), '2026-08-03T00:00:01.000Z');
    const repeatedDrop = save(
      completeSnapshot([observedVariant(modelId, 199_000)], 4),
      '2026-08-04T00:00:01.000Z',
    );

    expect(comparisonFor(repeatedDrop, modelId)).toMatchObject({
      reason: 'duplicate_transition',
      shouldNotify: false,
    });
  });

  it('rolls back the complete service transaction when a price insert fails', () => {
    harness.database.exec(`
      CREATE TRIGGER reject_phase5_price
      BEFORE INSERT ON price_logs
      BEGIN
        SELECT RAISE(ABORT, 'forced phase 5 rollback');
      END;
    `);

    expect(() =>
      save(completeSnapshot([observedVariant('1001', 250_000)], 1), '2026-08-01T00:00:01.000Z'),
    ).toThrow();
    expect(harness.repositories.products.countByOwner(owner.id)).toBe(0);

    for (const table of [
      'price_checks',
      'price_logs',
      'product_variants',
      'variant_check_results',
    ]) {
      expect(harness.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(
        0,
      );
    }
  });
});

describe('tracking lifecycle policy', () => {
  it('leaves an omitted variant neutral after a partial snapshot', () => {
    const first = observedVariant('1001', 250_000);
    const second = observedVariant('1002', 300_000);
    const initial = save(completeSnapshot([first, second], 1), '2026-08-01T00:00:01.000Z');
    save(partialSnapshot([first], 2), '2026-08-02T00:00:01.000Z');
    const storedSecond = initial.product.variants.find((variant) => variant.modelId === '1002');
    const currentSecond = harness.repositories.variants.findById({
      ownerUserId: owner.id,
      variantId: storedSecond.id,
    });

    expect(currentSecond).toMatchObject({
      consecutiveCompleteMisses: 0,
      lifecycleStatus: 'active',
    });
  });

  it('counts verified misses to inactive and resets presence even without a price', () => {
    const first = observedVariant('1001', 250_000);
    const second = observedVariant('1002', 300_000);
    save(completeSnapshot([first, second], 1), '2026-08-01T00:00:01.000Z');

    for (const sequence of [2, 3, 4]) {
      save(completeSnapshot([first], sequence), `2026-08-0${sequence}T00:00:01.000Z`);
    }

    let stored = productQueryService.getProduct({
      ownerUserId: owner.id,
      productId: harness.repositories.products.findByIdentity({
        itemId: loadValidSnapshot().itemId,
        ownerUserId: owner.id,
        shopId: loadValidSnapshot().shopId,
      }).id,
    });
    expect(stored.variants.find((variant) => variant.modelId === '1002')).toMatchObject({
      consecutiveCompleteMisses: 3,
      lifecycleStatus: 'inactive',
    });

    const returningWithoutPrice = notObservedVariant(second);
    save(partialSnapshot([returningWithoutPrice], 5), '2026-08-05T00:00:01.000Z');
    stored = productQueryService.getProduct({ ownerUserId: owner.id, productId: stored.id });
    expect(stored.variants.find((variant) => variant.modelId === '1002')).toMatchObject({
      consecutiveCompleteMisses: 0,
      lifecycleStatus: 'active',
    });
    expect(
      harness.repositories.prices
        .listPriceLogsByCheck({
          checkId: harness.database.prepare('SELECT MAX(id) AS id FROM price_checks').get().id,
          ownerUserId: owner.id,
        })
        .some(
          (price) =>
            price.variantId === stored.variants.find((variant) => variant.modelId === '1002').id,
        ),
    ).toBe(false);
  });

  it('treats the first valid price after reactivation as a new baseline', () => {
    const first = observedVariant('1001', 250_000);
    const second = observedVariant('1002', 300_000);
    save(completeSnapshot([first, second], 1), '2026-08-01T00:00:01.000Z');

    for (const sequence of [2, 3, 4]) {
      save(completeSnapshot([first], sequence), `2026-08-0${sequence}T00:00:01.000Z`);
    }

    const returnedSecond = observedVariant('1002', 100_000);
    const returning = save(
      completeSnapshot([first, returnedSecond], 5),
      '2026-08-05T00:00:01.000Z',
    );

    expect(comparisonFor(returning, '1002')).toMatchObject({
      reason: 'new_baseline_after_reactivation',
      shouldNotify: false,
    });
  });

  it('quarantines repeated mass disappearance before starting normal miss counts', () => {
    const variants = [
      observedVariant('1001', 100_000),
      observedVariant('1002', 200_000),
      observedVariant('1003', 300_000),
      observedVariant('1004', 400_000),
    ];
    save(completeSnapshot(variants, 1), '2026-08-01T00:00:01.000Z');

    const firstCandidate = save(completeSnapshot([variants[0]], 2), '2026-08-02T00:00:01.000Z');
    expect(firstCandidate.check.suspiciousMassDisappearance).toBe(true);
    expect(
      firstCandidate.product.variants.find((variant) => variant.modelId === '1002'),
    ).toMatchObject({ consecutiveCompleteMisses: 0, lifecycleStatus: 'active' });

    const confirmed = save(completeSnapshot([variants[0]], 3), '2026-08-03T00:00:01.000Z');
    expect(confirmed.product.variants.find((variant) => variant.modelId === '1002')).toMatchObject({
      consecutiveCompleteMisses: 1,
      lifecycleStatus: 'suspected_missing',
    });

    save(completeSnapshot([variants[0]], 4), '2026-08-04T00:00:01.000Z');
    const inactive = save(completeSnapshot([variants[0]], 5), '2026-08-05T00:00:01.000Z');
    expect(inactive.product.variants.find((variant) => variant.modelId === '1002')).toMatchObject({
      consecutiveCompleteMisses: 3,
      lifecycleStatus: 'inactive',
    });
  });
});

describe('product-query service', () => {
  it('always prefers user-session prices while retaining anonymous context prices', () => {
    const modelId = '1001';
    const userSession = save(
      completeSnapshot([observedVariant(modelId, 199_000)], 1),
      '2026-08-01T00:00:01.000Z',
    );
    save(
      completeSnapshot([observedVariant(modelId, 99_000)], 2, 'playwright'),
      '2026-08-02T00:00:01.000Z',
    );
    const product = productQueryService.getProduct({
      ownerUserId: owner.id,
      productId: userSession.product.id,
    });

    expect(product.currentLowestPrice).toMatchObject({
      priceAmount: 199_000,
      pricingContext: 'user_session',
    });
    expect(product.lowestPricesByContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ priceAmount: 199_000, pricingContext: 'user_session' }),
        expect.objectContaining({ priceAmount: 99_000, pricingContext: 'anonymous' }),
      ]),
    );
  });

  it('builds a real-price chart gap without inserting a null or zero price log', () => {
    const first = observedVariant('1001', 199_000);
    const second = notObservedVariant(first);
    const initial = save(completeSnapshot([first], 1), '2026-08-01T00:00:01.000Z');
    save(completeSnapshot([second], 2), '2026-08-02T00:00:01.000Z');
    save(completeSnapshot([observedVariant('1001', 179_000)], 3), '2026-08-03T00:00:01.000Z');
    const variantId = initial.product.variants[0].id;
    const history = productQueryService.getHistory({
      ownerUserId: owner.id,
      productId: initial.product.id,
      variantId,
    });

    expect(history.datasets).toHaveLength(1);
    expect(history.datasets[0].data.map((point) => point.y)).toEqual([199_000, null, 179_000]);
    expect(
      harness.repositories.prices.listHistory({
        ownerUserId: owner.id,
        productId: initial.product.id,
        variantId,
      }),
    ).toHaveLength(2);
  });

  it('returns owner-scoped pagination and rejects hidden product IDs', () => {
    const stored = save(
      completeSnapshot([observedVariant('1001', 199_000)], 1),
      '2026-08-01T00:00:01.000Z',
    );
    const page = productQueryService.listProducts({ limit: 20, ownerUserId: owner.id, page: 1 });
    const otherOwner = createTestOwner(harness.repositories, 'other@example.com');

    expect(page).toMatchObject({
      items: [{ id: stored.product.id }],
      pagination: { limit: 20, page: 1, pages: 1, total: 1 },
    });
    expect(() =>
      productQueryService.getProduct({
        ownerUserId: otherOwner.id,
        productId: stored.product.id,
      }),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.PRODUCT_NOT_FOUND }));
  });
});
