const DEFAULT_TARGET_URL =
  "https://shopee.vn/C%C3%A0-Ph%C3%AA-%C4%90%E1%BA%B7c-S%E1%BA%A3n-Fine-Robusta-Honey-Ph%C3%B9-H%E1%BB%A3p-Pha-Phin-v%C3%A0-Pha-M%C3%A1y-Every-Half-T%C3%BAi-200G-i.1259293184.26882883164";

const PRICE_DIVISOR = 100_000;

function extractShopeeIds(url) {
  const match = url.match(/i\.(\d+)\.(\d+)/);

  if (!match) {
    return null;
  }

  return {
    shopId: match[1],
    itemId: match[2],
  };
}

function toVnd(rawPrice) {
  if (rawPrice === null || rawPrice === undefined || rawPrice === "") {
    return null;
  }

  const numericPrice = Number(rawPrice);

  if (!Number.isSafeInteger(numericPrice) || numericPrice <= 0) {
    return null;
  }

  const priceAmount = numericPrice / PRICE_DIVISOR;

  return Number.isSafeInteger(priceAmount) && priceAmount > 0
    ? priceAmount
    : null;
}

function formatVnd(price) {
  if (price === null) {
    return "N/A";
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
  }).format(price);
}

function formatRawVnd(rawPrice) {
  const priceAmount = toVnd(rawPrice);

  return priceAmount === null
    ? "N/A"
    : `${formatVnd(priceAmount)} VND`;
}

function printProduct(item) {
  const models = Array.isArray(item.models) ? item.models : [];
  const variantPricing = Array.isArray(item.variant_pricing)
    ? item.variant_pricing
    : [];

  console.log("=================== PRODUCT DATA EXTRACTED ===================");
  console.log(`Title     : ${item.title || "N/A"}`);
  console.log(`Min Price : ${formatRawVnd(item.price_min)}`);
  console.log(`Max Price : ${formatRawVnd(item.price_max)}`);
  console.log("");
  console.log("--- Product Variations (SKUs) ---");

  if (models.length === 0) {
    console.log("No product variations found.");
    return;
  }

  models.forEach((model, index) => {
    const pricing = variantPricing[index];
    console.log(
      `Variation ${index + 1}: ${model.name || `Variation ${index + 1}`}`,
    );
    console.log(
      `  Base promo price : ${formatRawVnd(model.price)}`,
    );
    console.log(
      `  Original price   : ${formatRawVnd(
        model.price_before_discount,
      )}`,
    );
    console.log(
      `  Final display    : ${formatRawVnd(
        pricing?.final_display_price,
      )}`,
    );

    if (pricing?.error) {
      console.log(`  Final price note : ${pricing.error}`);
    }
  });
}

module.exports = {
  DEFAULT_TARGET_URL,
  extractShopeeIds,
  formatVnd,
  printProduct,
  toVnd,
};
