const assert = require("node:assert/strict");

const apiFailureFixture = require("./fixtures/shopee-api-failure.derived.json");
const boxerFixture = require("./fixtures/shopee-boxer-user-session.json");
const boxerAvailabilityFixture = require("./fixtures/shopee-boxer-targeted-availability-user-session.json");
const flashSaleFixture = require("./fixtures/shopee-flash-sale-user-session.json");
const fixture = require("./fixtures/shopee-multi-variant-user-session.json");
const partialFixture = require("./fixtures/shopee-partial-selected-variation.derived.json");
const shopVoucherFixture = require("./fixtures/shopee-shop-voucher-user-session.json");
const suspiciousEmptyFixture = require("./fixtures/shopee-suspicious-empty-catalogue.derived.json");
const unrecognisedPriceFixture = require("./fixtures/shopee-unrecognised-price-shape.derived.json");
const variantlessFixture = require("./fixtures/shopee-variantless-user-session.json");
const variantPriceFailureFixture = require("./fixtures/shopee-variant-price-failure.derived.json");
const {
  convertRawPriceToVnd,
  normalizeFixtureToSnapshot,
} = require("../phase1/fixture-normalizer");
const {
  createSanitizedFixture,
} = require("../phase1/fixture-sanitizer");
const { toVnd } = require("../product");

const SENSITIVE_KEY_PATTERN =
  /^(account|address|authorization|buyer|cookie|device|email|fingerprint|phone|session|signature|token|user_?id)$/i;

function assertNoSensitiveKeys(value, path = "fixture") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveKeys(entry, `${path}[${index}]`),
    );
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    assert.equal(
      SENSITIVE_KEY_PATTERN.test(key),
      false,
      `Sensitive key found at ${path}.${key}`,
    );
    assertNoSensitiveKeys(nestedValue, `${path}.${key}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  assert.equal(convertRawPriceToVnd(15_125_000_000), 151_250);
  assert.equal(convertRawPriceToVnd("25500000000"), 255_000);
  assert.throws(() => convertRawPriceToVnd(0), /positive safe integers/);
  assert.throws(() => convertRawPriceToVnd(null), /positive safe integers/);
  assert.throws(
    () => convertRawPriceToVnd(15_125_000_001),
    /positive safe integer/,
  );

  for (const savedFixture of [
    apiFailureFixture,
    boxerAvailabilityFixture,
    boxerFixture,
    flashSaleFixture,
    fixture,
    partialFixture,
    shopVoucherFixture,
    suspiciousEmptyFixture,
    unrecognisedPriceFixture,
    variantlessFixture,
    variantPriceFailureFixture,
  ]) {
    assertNoSensitiveKeys(savedFixture);
  }

  assert.equal(toVnd(15_125_000_000), 151_250);
  assert.equal(toVnd(null), null);
  assert.equal(toVnd(undefined), null);
  assert.equal(toVnd(0), null);
  assert.equal(toVnd("not-a-price"), null);

  const sanitisedDiagnosticFixture = createSanitizedFixture({
    capturedAt: "2026-07-27T00:00:00.000Z",
    initialPricingPayload: {},
    item: {
      itemid: 26882883164,
      models: [],
      shopid: 1259293184,
      title: "Public product title",
    },
    targetUrl:
      "https://shopee.vn/product-i.1259293184.26882883164",
    variantRequests: [
      {
        body: {
          item_id: 26882883164,
          quantity: 1,
          selected_tiers: { 0: 0 },
          shop_id: 1259293184,
        },
      },
    ],
    variantResponses: [
      {
        error: "Selection failed.",
        errorCode: "VARIATION_COMBINATION_UNAVAILABLE",
        errorDetails: {
          text: "Arbitrary page text must not be persisted.",
        },
        ok: false,
      },
    ],
  });
  const sanitisedDiagnosticResponse =
    sanitisedDiagnosticFixture.endpointEvidence.selectedVariations[0]
      .response;
  assert.equal(
    Object.hasOwn(sanitisedDiagnosticResponse, "errorDetails"),
    false,
  );

  const snapshot = normalizeFixtureToSnapshot(fixture);

  assert.equal(snapshot.platform, "shopee");
  assert.equal(snapshot.shopId, "1259293184");
  assert.equal(snapshot.itemId, "26882883164");
  assert.equal(snapshot.currency, "VND");
  assert.equal(
    snapshot.imageUrl,
    "https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-moywoh70u4uj55",
  );
  assert.equal(snapshot.pricingContext, "user_session");
  assert.equal(snapshot.variantCoverage, "complete");
  assert.equal(snapshot.coverageConfidence, "verified");
  assert.equal(snapshot.expectedVariantCount, 3);
  assert.equal(snapshot.observedVariantCount, 3);
  assert.equal(snapshot.pricedVariantCount, 3);
  assert.deepEqual(
    snapshot.variants.map((variant) => variant.modelId),
    ["280758809721", "280758809722", "280758809723"],
  );

  for (const variant of snapshot.variants) {
    assert.equal(variant.availability, "unknown");
    assert.equal(variant.priceObservation.status, "observed");
    assert.equal(variant.priceObservation.priceAmount, 151_250);
    assert.equal(
      variant.priceObservation.priceDefinition,
      "displayed_post_voucher_excluding_shipping",
    );
    assert.equal(
      variant.priceObservation.priceSource,
      "verified_display_field",
    );
    assert.equal(variant.priceObservation.voucherStatus, "not_applied");
    assert.equal(variant.priceObservation.shippingIncluded, false);
  }

  const variantlessSnapshot =
    normalizeFixtureToSnapshot(variantlessFixture);
  assert.equal(variantlessSnapshot.expectedVariantCount, 1);
  assert.equal(variantlessSnapshot.observedVariantCount, 1);
  assert.equal(variantlessSnapshot.pricedVariantCount, 1);
  assert.equal(variantlessSnapshot.variants[0].modelId, "default");
  assert.equal(variantlessSnapshot.variants[0].name, "Default");
  assert.equal(
    variantlessSnapshot.variants[0].priceObservation.priceAmount,
    25_600,
  );
  assert.equal(
    variantlessSnapshot.variants[0].priceObservation.priceSource,
    "product_detail_fallback",
  );
  assert.equal(
    variantlessSnapshot.variants[0].priceObservation.voucherStatus,
    "not_applied",
  );

  const failedVariantSnapshot = normalizeFixtureToSnapshot(
    variantPriceFailureFixture,
  );

  assert.equal(failedVariantSnapshot.observedVariantCount, 3);
  assert.equal(failedVariantSnapshot.pricedVariantCount, 2);
  assert.equal(
    failedVariantSnapshot.variants[2].priceObservation.status,
    "not_observed",
  );
  assert.equal(
    failedVariantSnapshot.variants[2].priceObservation.reason,
    "variation_response_failed",
  );

  const boxerSnapshot = normalizeFixtureToSnapshot(boxerFixture);
  assert.equal(boxerSnapshot.expectedVariantCount, 93);
  assert.equal(boxerSnapshot.observedVariantCount, 93);
  assert.equal(boxerSnapshot.pricedVariantCount, 3);
  assert.equal(
    boxerSnapshot.variants.filter(
      (variant) =>
        variant.priceObservation.reason === "variation_option_disabled",
    ).length,
    90,
  );

  for (const variant of boxerSnapshot.variants) {
    assert.equal(variant.availability, "unknown");

    if (variant.priceObservation.status === "not_observed") {
      assert.equal(
        Object.hasOwn(variant.priceObservation, "priceAmount"),
        false,
      );
    }
  }

  for (const variant of boxerSnapshot.variants.filter(
    (entry) => entry.priceObservation.status === "observed",
  )) {
    assert.equal(variant.priceObservation.priceAmount, 233_000);
    assert.equal(variant.priceObservation.voucherStatus, "applied");
    assert.ok(
      [
        "product_detail_fallback",
        "variation_price_breakdown",
      ].includes(variant.priceObservation.priceSource),
    );
    assert.ok(variant.priceObservation.priceAmount > 0);
  }

  const boxerAvailabilitySnapshot = normalizeFixtureToSnapshot(
    boxerAvailabilityFixture,
  );
  assert.equal(boxerAvailabilitySnapshot.expectedVariantCount, 93);
  assert.equal(boxerAvailabilitySnapshot.observedVariantCount, 93);
  assert.equal(boxerAvailabilitySnapshot.pricedVariantCount, 12);
  assert.equal(
    boxerAvailabilitySnapshot.variants.filter(
      (variant) => variant.availability === "unavailable",
    ).length,
    21,
  );
  assert.equal(
    boxerAvailabilitySnapshot.variants.filter(
      (variant) =>
        variant.priceObservation.reason ===
        "variation_combination_unavailable",
    ).length,
    21,
  );
  assert.deepEqual(
    boxerAvailabilitySnapshot.variants
      .filter(
        (variant) => variant.priceObservation.status === "observed",
      )
      .map((variant) => variant.modelId),
    [
      "227534004080",
      "223959288907",
      "223959288901",
      "227534004086",
      "257921564639",
      "257921564637",
      "257921564656",
      "257921564638",
      "257921564659",
      "257921564668",
      "257921564498",
      "257921564671",
    ],
  );

  const shopVoucherSnapshot =
    normalizeFixtureToSnapshot(shopVoucherFixture);
  assert.equal(shopVoucherSnapshot.expectedVariantCount, 40);
  assert.equal(shopVoucherSnapshot.observedVariantCount, 40);
  assert.equal(shopVoucherSnapshot.pricedVariantCount, 40);
  assert.equal(
    shopVoucherSnapshot.variants.every(
      (variant) =>
        variant.priceObservation.status === "observed" &&
        variant.priceObservation.voucherStatus === "applied" &&
        variant.priceObservation.priceSource ===
          "variation_price_breakdown",
    ),
    true,
  );
  assert.equal(
    Math.min(
      ...shopVoucherSnapshot.variants.map(
        (variant) => variant.priceObservation.priceAmount,
      ),
    ),
    113_819,
  );
  assert.equal(
    Math.max(
      ...shopVoucherSnapshot.variants.map(
        (variant) => variant.priceObservation.priceAmount,
      ),
    ),
    119_000,
  );

  for (const evidence of
    shopVoucherFixture.endpointEvidence.selectedVariations) {
    const priceBreakdown =
      evidence.response.payload.data.price_breakdown;
    const productPrice =
      evidence.response.payload.data.product_price;
    const shopDiscount = priceBreakdown.discount_breakdown.find(
      (discount) => discount.price_source === "Shop Voucher Discount",
    );

    assert.ok(shopDiscount?.shop_voucher);
    assert.equal(shopDiscount.platform_voucher, null);
    assert.equal(shopDiscount.discount_amount, 14_000_000_000);
    assert.equal(
      productPrice.final_price_info.final_price_vouchers
        .platform_voucher,
      null,
    );
    assert.ok(
      productPrice.final_price_info.final_price_vouchers
        .shop_voucher,
    );
    assert.deepEqual(
      productPrice.final_price_vouchers.map(
        (voucher) => voucher.voucher_type,
      ),
      [1],
    );
  }

  const flashSaleSnapshot =
    normalizeFixtureToSnapshot(flashSaleFixture);
  assert.equal(flashSaleSnapshot.expectedVariantCount, 6);
  assert.equal(flashSaleSnapshot.observedVariantCount, 6);
  assert.equal(flashSaleSnapshot.pricedVariantCount, 1);
  const flashSaleObservation = flashSaleSnapshot.variants.find(
    (variant) => variant.priceObservation.status === "observed",
  );
  assert.equal(flashSaleObservation.modelId, "227853273170");
  assert.equal(flashSaleObservation.priceObservation.priceAmount, 146_740);
  assert.equal(
    flashSaleObservation.priceObservation.priceSource,
    "product_detail_fallback",
  );
  assert.equal(
    flashSaleObservation.priceObservation.voucherStatus,
    "not_applied",
  );
  assert.equal(
    flashSaleFixture.endpointEvidence.productDetail.response.data.pricing
      .data.product_price.price_promotion
      .price_single_promotion_type,
    302,
  );
  assert.equal(
    flashSaleSnapshot.variants.filter(
      (variant) => variant.priceObservation.status === "not_observed",
    ).length,
    5,
  );

  const changedShapeSnapshot = normalizeFixtureToSnapshot(
    unrecognisedPriceFixture,
  );
  assert.equal(changedShapeSnapshot.variantCoverage, "complete");
  assert.equal(changedShapeSnapshot.observedVariantCount, 1);
  assert.equal(changedShapeSnapshot.pricedVariantCount, 0);
  assert.equal(
    changedShapeSnapshot.variants[0].priceObservation.status,
    "not_observed",
  );

  assert.equal(
    partialFixture.expectedClassification.variantCoverage,
    "partial",
  );
  assert.equal(
    partialFixture.expectedClassification.lifecycleEligible,
    false,
  );
  assert.throws(
    () => normalizeFixtureToSnapshot(partialFixture),
    /get_pc product model catalogue/,
  );

  assert.equal(
    suspiciousEmptyFixture.expectedClassification.suspicious,
    true,
  );
  assert.throws(
    () => normalizeFixtureToSnapshot(suspiciousEmptyFixture),
    /non-empty get_pc product model catalogue/,
  );

  assert.equal(
    apiFailureFixture.expectedClassification.lifecycleEligible,
    false,
  );
  assert.throws(
    () => normalizeFixtureToSnapshot(apiFailureFixture),
    /get_pc product model catalogue/,
  );

  const mismatchedFixture = clone(fixture);
  mismatchedFixture.endpointEvidence.productDetail.response.data.item.itemid =
    1;
  assert.throws(
    () => normalizeFixtureToSnapshot(mismatchedFixture),
    /product IDs do not match/,
  );

  const mismatchedModelFixture = clone(fixture);
  mismatchedModelFixture.endpointEvidence.selectedVariations[0].response.payload.data.product_price.price_model.price_single_model_id =
    1;
  const mismatchedModelSnapshot = normalizeFixtureToSnapshot(
    mismatchedModelFixture,
  );
  assert.equal(mismatchedModelSnapshot.pricedVariantCount, 2);
  assert.equal(
    mismatchedModelSnapshot.variants[0].priceObservation.reason,
    "variation_response_model_mismatch",
  );

  const emptyCatalogueFixture = clone(fixture);
  emptyCatalogueFixture.endpointEvidence.productDetail.response.data.item.models =
    [];
  assert.throws(
    () => normalizeFixtureToSnapshot(emptyCatalogueFixture),
    /non-empty get_pc product model catalogue/,
  );

  console.log("Phase 1 fixture and raw-price tests passed");
}

main();
