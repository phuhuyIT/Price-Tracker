import { describe, expect, it } from 'vitest';

import {
  buildTierDefinitions,
  createVariantRequests,
  selectedTiersKey,
} from '../../../apps/extension/content/variantSelection.js';

const product = {
  itemId: '20',
  models: [{ tierIndex: [0, 1] }, { tierIndex: [1, 0] }],
  shopId: '10',
  tierVariations: [
    { name: 'Colour', options: ['Red', 'Blue'] },
    { name: 'Size', options: ['Small', 'Large'] },
  ],
};

describe('background variant selection descriptors', () => {
  it('builds exact request bodies and stable selection keys', () => {
    const requests = createVariantRequests(product);

    expect(requests).toEqual([
      {
        body: {
          item_id: 20,
          quantity: 1,
          selected_tiers: { 0: 0, 1: 1 },
          shop_id: 10,
        },
        modelIndex: 0,
        selectedTiers: { 0: 0, 1: 1 },
      },
      {
        body: {
          item_id: 20,
          quantity: 1,
          selected_tiers: { 0: 1, 1: 0 },
          shop_id: 10,
        },
        modelIndex: 1,
        selectedTiers: { 0: 1, 1: 0 },
      },
    ]);
    expect(selectedTiersKey({ 1: 0, 0: 1 })).toBe('0:1|1:0');
  });

  it('derives rendered tier definitions from catalogue evidence', () => {
    expect(buildTierDefinitions(product, createVariantRequests(product))).toEqual([
      { name: 'Colour', optionCount: 2, optionLabels: ['Red', 'Blue'] },
      { name: 'Size', optionCount: 2, optionLabels: ['Small', 'Large'] },
    ]);
  });

  it('does not create a runnable request for invalid or implicit selections', () => {
    expect(createVariantRequests({ ...product, models: [{ tierIndex: [] }] })).toEqual([
      {
        error: 'The model does not contain a valid tier selection.',
        modelIndex: 0,
        selectedTiers: null,
      },
    ]);
  });
});
