const { chromium } = require("playwright");

const DEFAULT_TARGET_URL =
  "https://shopee.vn/C%C3%A0-Ph%C3%AA-%C4%90%E1%BA%B7c-S%E1%BA%A3n-Fine-Robusta-Honey-Ph%C3%B9-H%E1%BB%A3p-Pha-Phin-v%C3%A0-Pha-M%C3%A1y-Every-Half-T%C3%BAi-200G-i.1259293184.26882883164";

const PRICE_DIVISOR = 100_000;
const RESPONSE_TIMEOUT_MS = 30_000;

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
  const numericPrice = Number(rawPrice);

  if (!Number.isFinite(numericPrice)) {
    return null;
  }

  return numericPrice / PRICE_DIVISOR;
}

function formatVnd(price) {
  if (price === null) {
    return "N/A";
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
  }).format(price);
}

function printProduct(item) {
  const minPrice = toVnd(item.price_min);
  const maxPrice = toVnd(item.price_max);
  const models = Array.isArray(item.models) ? item.models : [];

  console.log("=================== PRODUCT DATA EXTRACTED ===================");
  console.log(`Title     : ${item.title || "N/A"}`);
  console.log(`Min Price : ${formatVnd(minPrice)} VND`);
  console.log(`Max Price : ${formatVnd(maxPrice)} VND`);
  console.log("");
  console.log("--- Product Variations (SKUs) ---");

  if (models.length === 0) {
    console.log("No product variations found.");
    return;
  }

  models.forEach((model, index) => {
    const name = model.name || `Variation ${index + 1}`;
    console.log(
      `Variation ${index + 1}: ${name} -> ${formatVnd(toVnd(model.price))} VND`,
    );
  });
}

function waitForProductData(page) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off("response", handleResponse);
      reject(
        new Error(
          `Timed out after ${RESPONSE_TIMEOUT_MS / 1000} seconds waiting for Shopee product data.`,
        ),
      );
    }, RESPONSE_TIMEOUT_MS);

    async function handleResponse(response) {
      if (!response.url().includes("/api/v4/pdp/get_pc")) {
        return;
      }

      try {
        const payload = await response.json();
        const item = payload?.data?.item;

        if (!item) {
          return;
        }

        clearTimeout(timeout);
        page.off("response", handleResponse);
        resolve(item);
      } catch (error) {
        console.warn(`Could not parse a matching API response: ${error.message}`);
      }
    }

    page.on("response", handleResponse);
  });
}

async function main() {
  const targetUrl = process.argv[2] || DEFAULT_TARGET_URL;
  const ids = extractShopeeIds(targetUrl);

  if (!ids) {
    console.error(
      "Invalid Shopee product URL. Expected a URL containing i.<shopId>.<itemId>.",
    );
    process.exitCode = 1;
    return;
  }

  let browser;

  try {
    console.log(
      `Opening Shopee product (shopId=${ids.shopId}, itemId=${ids.itemId})...`,
    );

    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Attach the listener before navigation so the PDP request cannot be missed.
    const productDataPromise = waitForProductData(page);

    const [, item] = await Promise.all([
      page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: RESPONSE_TIMEOUT_MS,
      }),
      productDataPromise,
    ]);

    printProduct(item);
  } catch (error) {
    console.error(`Failed to extract product data: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractShopeeIds,
  formatVnd,
  toVnd,
};
