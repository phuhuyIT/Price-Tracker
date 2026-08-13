import { describe, expect, it } from 'vitest';

import { createVariationClicker } from '../../../apps/extension/content/variationControls.js';

function selectedTiersKey(selectedTiers) {
  return Object.entries(selectedTiers)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([tier, option]) => `${tier}:${option}`)
    .join('|');
}

function createStatefulAdapter({ availableCombinations, initialSelection }) {
  const available = new Set(availableCombinations.map(selectedTiersKey));
  const selected = { ...initialSelection };
  const clicks = [];

  function isOptionEnabled(tierIndex, optionIndex) {
    const candidate = { ...selected, [tierIndex]: optionIndex };

    return [...available].some((key) => {
      const combination = Object.fromEntries(
        key.split('|').map((entry) => {
          const [tier, option] = entry.split(':').map(Number);
          return [tier, option];
        }),
      );
      return Object.entries(candidate).every(
        ([tier, option]) => combination[Number(tier)] === Number(option),
      );
    });
  }

  return {
    async click(tierIndex, optionIndex) {
      clicks.push([tierIndex, optionIndex]);

      if (selected[tierIndex] === optionIndex) {
        delete selected[tierIndex];
      } else {
        selected[tierIndex] = optionIndex;
      }
    },
    clicks,
    async locate(_definitions, tierIndex, optionIndex) {
      return {
        disabled: !isOptionEnabled(tierIndex, optionIndex),
        error: null,
        optionIndex,
        selected: selected[tierIndex] === optionIndex,
        tierIndex,
        x: tierIndex,
        y: optionIndex,
      };
    },
    async locateSelected() {
      return Object.entries(selected).map(([tier, option]) => ({
        disabled: false,
        optionIndex: Number(option),
        selected: true,
        tierIndex: Number(tier),
        x: Number(tier),
        y: Number(option),
      }));
    },
    selected,
    async wait() {},
  };
}

const definitions = [{ optionCount: 2 }, { optionCount: 2 }];

describe('rendered Shopee variation controls', () => {
  it('clears the previous combination before selecting the requested one', async () => {
    const adapter = createStatefulAdapter({
      availableCombinations: [
        { 0: 0, 1: 0 },
        { 0: 1, 1: 1 },
      ],
      initialSelection: { 0: 0, 1: 0 },
    });
    const clicker = createVariationClicker(adapter, { clickDelayMs: 0 });

    await expect(clicker.clickCombination(definitions, { 0: 1, 1: 1 })).resolves.toBeNull();
    expect(adapter.selected).toEqual({ 0: 1, 1: 1 });
    expect(adapter.clicks).toEqual([
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('returns a typed error for an unavailable combination', async () => {
    const adapter = createStatefulAdapter({
      availableCombinations: [{ 0: 0, 1: 0 }],
      initialSelection: {},
    });
    const clicker = createVariationClicker(adapter, { clickDelayMs: 0 });

    await expect(clicker.clickCombination(definitions, { 0: 1, 1: 1 })).resolves.toMatchObject({
      code: 'VARIATION_COMBINATION_UNAVAILABLE',
      details: null,
    });
  });
});
