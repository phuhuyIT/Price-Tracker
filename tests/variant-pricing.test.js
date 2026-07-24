const assert = require("node:assert/strict");

const {
  createVariantRequests,
  extractFinalDisplayPrice,
  mergeVariantPricing,
  normalizeSelectedTiers,
  storePreferredResponse,
} = require("../variant-pricing");

function main() {
  assert.deepEqual(normalizeSelectedTiers([2, 1]), { 0: 2, 1: 1 });
  assert.deepEqual(normalizeSelectedTiers({ 0: 3 }), { 0: 3 });
  assert.equal(normalizeSelectedTiers([0, -1]), null);
  assert.equal(normalizeSelectedTiers(null), null);

  const item = {
    models: [
      {
        extinfo: { tier_index: [0, 1] },
        modelid: 11,
        name: "Red, Large",
        price: 10_000_000,
        price_before_discount: 12_000_000,
      },
      {
        extinfo: {},
        modelid: 12,
        name: "Missing tier",
        price: 20_000_000,
        price_before_discount: 22_000_000,
      },
    ],
  };
  const requests = createVariantRequests(item, {
    itemId: "456",
    shopId: "123",
  });

  assert.deepEqual(requests[0].body, {
    item_id: 456,
    quantity: 1,
    selected_tiers: { 0: 0, 1: 1 },
    shop_id: 123,
  });
  assert.match(requests[1].error, /tier_index/);

  assert.equal(
    extractFinalDisplayPrice({
      data: {
        price_breakdown: {
          price: { singlevalue: 7_500_000 },
        },
      },
    }),
    7_500_000,
  );
  assert.equal(
    extractFinalDisplayPrice({
      data: {
        product_price: {
          price: { single_value: 8_500_000 },
        },
      },
    }),
    8_500_000,
  );

  const captured = new Map();
  const pricedResponse = {
    error: null,
    ok: true,
    payload: {
      data: {
        price_breakdown: {
          price: { singlevalue: 7_500_000 },
        },
      },
    },
    status: 200,
  };

  storePreferredResponse(captured, "0:0", pricedResponse);
  storePreferredResponse(captured, "0:0", {
    error: null,
    ok: true,
    payload: { data: { selected_model_id: 11 } },
    status: 200,
  });
  assert.equal(captured.get("0:0"), pricedResponse);

  const variantPricing = mergeVariantPricing(item, requests, [
    {
      error: null,
      ok: true,
      payload: {
        data: {
          price_breakdown: {
            price: { singlevalue: 7_500_000 },
          },
        },
      },
      status: 200,
    },
  ]);

  assert.equal(variantPricing[0].final_display_price, 7_500_000);
  assert.equal(variantPricing[0].price, 10_000_000);
  assert.equal(variantPricing[0].price_before_discount, 12_000_000);
  assert.equal(variantPricing[0].error, null);
  assert.equal(variantPricing[1].final_display_price, null);
  assert.match(variantPricing[1].error, /tier_index/);

  const missingPricePricing = mergeVariantPricing(
    { models: [item.models[0]] },
    [requests[0]],
    [
      {
        error: null,
        ok: true,
        payload: { data: { selected_model_id: 11 } },
        status: 200,
      },
    ],
  );
  assert.match(
    missingPricePricing[0].error,
    /data keys: selected_model_id/,
  );

  console.log("Variant-pricing unit tests passed");
}

main();
