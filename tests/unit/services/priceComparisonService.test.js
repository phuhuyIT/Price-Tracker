import { describe, expect, it } from 'vitest';

import { calculatePriceDropPercentage } from '../../../apps/server/src/services/priceComparisonService.js';

describe('price-drop calculation', () => {
  it('calculates a percentage reduction without rounding business precision', () => {
    expect(calculatePriceDropPercentage(250_000, 199_000)).toBeCloseTo(20.4, 10);
  });

  it('rejects missing, zero, negative, and fractional amounts', () => {
    expect(() => calculatePriceDropPercentage(0, 100)).toThrow(/positive safe integers/u);
    expect(() => calculatePriceDropPercentage(100, -1)).toThrow(/positive safe integers/u);
    expect(() => calculatePriceDropPercentage(100.5, 100)).toThrow(/positive safe integers/u);
  });
});
