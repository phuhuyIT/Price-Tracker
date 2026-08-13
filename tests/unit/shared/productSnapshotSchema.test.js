import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isLifecycleEligibleCoverage,
  productSnapshotSchema,
  variantCatalogueCoverageSchema,
  variantCheckResultSchema,
} from '../../../packages/shared/index.js';

const exampleSnapshot = JSON.parse(
  readFileSync(new URL('../../fixtures/valid-product-snapshot.json', import.meta.url), 'utf8'),
);

function validSnapshot() {
  return structuredClone(exampleSnapshot);
}

describe('product snapshot schema', () => {
  it('accepts the documented complete user-session snapshot', () => {
    expect(productSnapshotSchema.parse(validSnapshot())).toEqual(exampleSnapshot);
  });

  it('accepts a present variant whose price was not observed', () => {
    const result = productSnapshotSchema.parse(validSnapshot());

    expect(result.variants[1]).toMatchObject({
      availability: 'unknown',
      modelId: '280758809722',
      priceObservation: {
        reason: 'variation_response_missing',
        status: 'not_observed',
      },
    });
    expect(result.variants[1].priceObservation).not.toHaveProperty('priceAmount');
  });

  it('accepts known stock and rejects invalid or availability-conflicting quantities', () => {
    const valid = validSnapshot();
    expect(productSnapshotSchema.parse(valid).variants[0].stockQuantity).toBe(12);

    for (const stockQuantity of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = validSnapshot();
      invalid.variants[0].stockQuantity = stockQuantity;
      expect(productSnapshotSchema.safeParse(invalid).success).toBe(false);
    }

    const conflicting = validSnapshot();
    conflicting.variants[0].stockQuantity = 0;
    expect(productSnapshotSchema.safeParse(conflicting).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid price amount %s',
    (priceAmount) => {
      const snapshot = validSnapshot();
      snapshot.variants[0].priceObservation.priceAmount = priceAmount;

      expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
    },
  );

  it('rejects missing and empty variants', () => {
    const missing = validSnapshot();
    delete missing.variants;
    const empty = validSnapshot();
    empty.variants = [];
    empty.expectedVariantCount = 0;
    empty.observedVariantCount = 0;
    empty.pricedVariantCount = 0;

    expect(productSnapshotSchema.safeParse(missing).success).toBe(false);
    expect(productSnapshotSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects price fields on a not-observed result', () => {
    const snapshot = validSnapshot();
    snapshot.variants[1].priceObservation.priceAmount = 100_000;

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects a not-observed result without a reason', () => {
    const snapshot = validSnapshot();
    delete snapshot.variants[1].priceObservation.reason;

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects unknown pricing context for a new snapshot', () => {
    const snapshot = validSnapshot();
    snapshot.pricingContext = 'unknown';

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('requires extension and Playwright sources to match their contexts', () => {
    const snapshot = validSnapshot();
    snapshot.source = 'playwright';

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);

    snapshot.pricingContext = 'anonymous';
    snapshot.pricingContextKey = 'local_anonymous_v1';

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rejects unsupported currency and currency disagreement', () => {
    const unsupported = validSnapshot();
    unsupported.currency = 'USD';

    expect(productSnapshotSchema.safeParse(unsupported).success).toBe(false);

    const disagreement = validSnapshot();
    disagreement.variants[0].priceObservation.currency = 'USD';

    expect(productSnapshotSchema.safeParse(disagreement).success).toBe(false);
  });

  it('rejects a non-HTTPS product image URL', () => {
    const snapshot = validSnapshot();
    snapshot.imageUrl = 'http://example.com/product.jpg';

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects shipping-inclusive prices', () => {
    const snapshot = validSnapshot();
    snapshot.variants[0].priceObservation.shippingIncluded = true;

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it.each(['not-a-date', '2026-02-30T10:00:00.000Z', '2026-07-30'])(
    'rejects invalid captured timestamp %s',
    (capturedAt) => {
      const snapshot = validSnapshot();
      snapshot.capturedAt = capturedAt;

      expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
    },
  );

  it('rejects missing, malformed, and URL-mismatched product IDs', () => {
    const missing = validSnapshot();
    delete missing.shopId;
    const malformed = validSnapshot();
    malformed.itemId = 'abc';
    const mismatch = validSnapshot();
    mismatch.itemId = '999';

    expect(productSnapshotSchema.safeParse(missing).success).toBe(false);
    expect(productSnapshotSchema.safeParse(malformed).success).toBe(false);
    expect(productSnapshotSchema.safeParse(mismatch).success).toBe(false);
  });

  it('rejects duplicate variant identities', () => {
    const snapshot = validSnapshot();
    snapshot.variants[1].modelId = snapshot.variants[0].modelId;

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects unknown observed price sources', () => {
    const snapshot = validSnapshot();
    snapshot.variants[0].priceObservation.priceSource = 'unknown';

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects raw or undeclared response fields', () => {
    const snapshot = validSnapshot();
    snapshot.rawResponse = { data: { item: {} } };

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

describe('catalogue coverage schema', () => {
  it.each([
    {
      coverageConfidence: 'verified',
      expectedVariantCount: 2,
      lifecycleEligible: true,
      observedVariantCount: 2,
      pricedVariantCount: 1,
      variantCoverage: 'complete',
    },
    {
      coverageConfidence: 'partial',
      expectedVariantCount: null,
      lifecycleEligible: false,
      observedVariantCount: 1,
      pricedVariantCount: 1,
      variantCoverage: 'partial',
    },
    {
      coverageConfidence: 'unknown',
      expectedVariantCount: null,
      lifecycleEligible: false,
      observedVariantCount: 1,
      pricedVariantCount: 0,
      variantCoverage: 'unknown',
    },
  ])('accepts internally consistent $variantCoverage coverage', (coverage) => {
    expect(variantCatalogueCoverageSchema.safeParse(coverage).success).toBe(true);
  });

  it('allows only verified complete coverage to be lifecycle eligible', () => {
    expect(
      isLifecycleEligibleCoverage({
        coverageConfidence: 'verified',
        variantCoverage: 'complete',
      }),
    ).toBe(true);
    expect(
      isLifecycleEligibleCoverage({
        coverageConfidence: 'likely_complete',
        variantCoverage: 'complete',
      }),
    ).toBe(false);

    const partial = {
      coverageConfidence: 'partial',
      expectedVariantCount: null,
      lifecycleEligible: true,
      observedVariantCount: 1,
      pricedVariantCount: 1,
      variantCoverage: 'partial',
    };

    expect(variantCatalogueCoverageSchema.safeParse(partial).success).toBe(false);
  });

  it.each([
    {
      expectedVariantCount: 1,
      observedVariantCount: 2,
      pricedVariantCount: 1,
    },
    {
      expectedVariantCount: 2,
      observedVariantCount: 2,
      pricedVariantCount: 3,
    },
    {
      expectedVariantCount: null,
      observedVariantCount: 2,
      pricedVariantCount: 1,
    },
  ])('rejects inconsistent complete counts %#', (counts) => {
    expect(
      variantCatalogueCoverageSchema.safeParse({
        coverageConfidence: 'verified',
        lifecycleEligible: true,
        variantCoverage: 'complete',
        ...counts,
      }).success,
    ).toBe(false);
  });
});

describe('synthetic default variant', () => {
  it('accepts one positively verified synthetic default variant', () => {
    const snapshot = validSnapshot();
    snapshot.expectedVariantCount = 1;
    snapshot.observedVariantCount = 1;
    snapshot.pricedVariantCount = 1;
    snapshot.variants = [
      {
        ...snapshot.variants[0],
        identityType: 'synthetic_default',
        modelId: 'default',
        name: 'Default',
      },
    ];

    expect(productSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rejects default mixed with explicit variants or unverified coverage', () => {
    const mixed = validSnapshot();
    mixed.variants[0] = {
      ...mixed.variants[0],
      identityType: 'synthetic_default',
      modelId: 'default',
      name: 'Default',
    };

    expect(productSnapshotSchema.safeParse(mixed).success).toBe(false);

    const unverified = validSnapshot();
    unverified.expectedVariantCount = 1;
    unverified.observedVariantCount = 1;
    unverified.pricedVariantCount = 1;
    unverified.variants = [
      {
        ...unverified.variants[0],
        identityType: 'synthetic_default',
        modelId: 'default',
        name: 'Default',
      },
    ];
    unverified.coverageConfidence = 'likely_complete';
    unverified.lifecycleEligible = false;

    expect(productSnapshotSchema.safeParse(unverified).success).toBe(false);
  });
});

describe('per-variant check result schema', () => {
  it('accepts a present variant with a failed price observation', () => {
    expect(
      variantCheckResultSchema.safeParse({
        availability: 'unknown',
        lifecycleEligible: false,
        presence: 'present',
        priceStatus: 'not_observed',
        reasonCode: 'variation_response_failed',
        variantId: 1,
        variantLifecycle: 'active',
      }).success,
    ).toBe(true);
  });

  it('accepts lifecycle evidence only for an absent variant', () => {
    const absentResult = {
      availability: 'unknown',
      lifecycleEligible: true,
      presence: 'absent',
      priceStatus: 'not_observed',
      reasonCode: 'missing_from_verified_complete_snapshot',
      variantId: 1,
      variantLifecycle: 'suspected_missing',
    };

    expect(variantCheckResultSchema.safeParse(absentResult).success).toBe(true);
    expect(
      variantCheckResultSchema.safeParse({
        ...absentResult,
        presence: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('accepts consistent present stock but rejects stock on absent results', () => {
    const present = {
      availability: 'available',
      lifecycleEligible: false,
      presence: 'present',
      priceStatus: 'observed',
      stockQuantity: 12,
      variantId: 1,
      variantLifecycle: 'active',
    };
    expect(variantCheckResultSchema.safeParse(present).success).toBe(true);
    expect(
      variantCheckResultSchema.safeParse({
        ...present,
        availability: 'unknown',
        presence: 'absent',
        priceStatus: 'not_observed',
        reasonCode: 'missing_from_verified_complete_snapshot',
      }).success,
    ).toBe(false);
  });
});
