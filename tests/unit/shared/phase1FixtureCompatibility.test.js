import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { productSnapshotSchema } from '../../../packages/shared/index.js';

const require = createRequire(import.meta.url);
const multiVariantFixture = require('../../fixtures/shopee-multi-variant-user-session.json');
const variantlessFixture = require('../../fixtures/shopee-variantless-user-session.json');
const { normalizeFixtureToSnapshot } = require('../../../phase1/fixture-normalizer.js');

describe('Phase 1 fixture compatibility', () => {
  it('validates the live multi-variant fixture with the shared contract', () => {
    const snapshot = normalizeFixtureToSnapshot(multiVariantFixture, {
      pricingContextKey: 'phase1_test_profile',
    });
    const result = productSnapshotSchema.parse(snapshot);

    expect(result.variants).toHaveLength(3);
    expect(result.pricedVariantCount).toBe(3);
    expect(result.lifecycleEligible).toBe(true);
  });

  it('validates the positively identified variantless fixture', () => {
    const snapshot = normalizeFixtureToSnapshot(variantlessFixture, {
      pricingContextKey: 'phase1_test_profile',
    });
    const result = productSnapshotSchema.parse(snapshot);

    expect(result.variants).toEqual([
      expect.objectContaining({
        identityType: 'synthetic_default',
        modelId: 'default',
        name: 'Default',
      }),
    ]);
  });
});
