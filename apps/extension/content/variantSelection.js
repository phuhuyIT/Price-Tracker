function normaliseSelectedTiers(tierIndex) {
  const entries = Array.isArray(tierIndex)
    ? tierIndex.map((value, index) => [String(index), value])
    : tierIndex && typeof tierIndex === 'object'
      ? Object.entries(tierIndex)
      : [];
  const selectedTiers = {};

  for (const [tier, option] of entries) {
    const numericOption = Number(option);

    if (!Number.isInteger(numericOption) || numericOption < 0) {
      return null;
    }

    selectedTiers[String(tier)] = numericOption;
  }

  return Object.keys(selectedTiers).length > 0 ? selectedTiers : null;
}

/** Return the stable correlation key for one exact tier selection. */
export function selectedTiersKey(selectedTiers) {
  const normalised = normaliseSelectedTiers(selectedTiers);

  if (!normalised) {
    return null;
  }

  return Object.keys(normalised)
    .sort((left, right) => Number(left) - Number(right))
    .map((tier) => `${tier}:${normalised[tier]}`)
    .join('|');
}

function normaliseId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) ? numericValue : value;
}

/** Build one Shopee selection request descriptor per captured catalogue model. */
export function createVariantRequests(product) {
  const models = Array.isArray(product?.models) ? product.models : [];

  return models.map((model, modelIndex) => {
    const selectedTiers = normaliseSelectedTiers(model?.tierIndex);

    if (!selectedTiers) {
      return {
        error: 'The model does not contain a valid tier selection.',
        modelIndex,
        selectedTiers: null,
      };
    }

    if (product?.shopId === undefined || product?.itemId === undefined) {
      return {
        error: 'The shop ID or item ID is missing.',
        modelIndex,
        selectedTiers,
      };
    }

    return {
      body: {
        item_id: normaliseId(product.itemId),
        quantity: 1,
        selected_tiers: selectedTiers,
        shop_id: normaliseId(product.shopId),
      },
      modelIndex,
      selectedTiers,
    };
  });
}

/** Derive rendered tier labels and option counts from the verified catalogue. */
export function buildTierDefinitions(product, requests) {
  const sourceTiers = Array.isArray(product?.tierVariations) ? product.tierVariations : [];
  const optionCounts = [];

  for (const request of requests) {
    for (const [tier, option] of Object.entries(request.selectedTiers ?? {})) {
      const tierIndex = Number(tier);
      optionCounts[tierIndex] = Math.max(optionCounts[tierIndex] ?? 0, Number(option) + 1);
    }
  }

  return optionCounts.map((optionCount, tierIndex) => {
    const sourceOptions = Array.isArray(sourceTiers[tierIndex]?.options)
      ? sourceTiers[tierIndex].options
      : [];

    return {
      name: sourceTiers[tierIndex]?.name ?? null,
      optionCount,
      optionLabels: Array.from({ length: optionCount }, (_, optionIndex) => {
        const option = sourceOptions[optionIndex];
        return typeof option === 'string' ? option : (option?.option ?? option?.name ?? null);
      }),
    };
  });
}
