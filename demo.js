const { openBrowserSession } = require("./playwright-browser");
const {
  DEFAULT_TARGET_URL,
  extractShopeeIds,
  formatVnd,
  printProduct,
  toVnd,
} = require("./product");
const { fetchVariantPricing } = require("./variant-pricing");

const RESPONSE_TIMEOUT_MS = 30_000;

function waitForProductData(page, timeoutMs = RESPONSE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      page.off("response", handleResponse);
      page.off("close", handleClose);
    };

    const settle = (error, productData) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (error) {
        reject(error);
      } else {
        resolve(productData);
      }
    };

    const timeout = setTimeout(() => {
      settle(
        new Error(
          `Timed out after ${timeoutMs / 1000} seconds waiting for Shopee product data.`,
        ),
      );
    }, timeoutMs);

    function handleClose() {
      settle(
        new Error(
          "The browser page closed before Shopee product data was captured.",
        ),
      );
    }

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

        settle(null, {
          initialPriceBreakdown:
            payload?.data?.price_breakdown ??
            payload?.data?.product_price ??
            item.price_breakdown ??
            null,
          item,
        });
      } catch (error) {
        console.warn(`Could not parse a matching API response: ${error.message}`);
      }
    }

    page.on("response", handleResponse);
    page.on("close", handleClose);
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

  let page;
  let session;

  try {
    console.log(
      `Opening Shopee product (shopId=${ids.shopId}, itemId=${ids.itemId})...`,
    );

    session = await openBrowserSession();
    page = await session.context.newPage();

    // Listen before navigation so the initial product response cannot be missed.
    const productDataPromise = waitForProductData(page);
    const [, productData] = await Promise.all([
      page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: RESPONSE_TIMEOUT_MS,
      }),
      productDataPromise,
    ]);

    const modelCount = Array.isArray(productData.item.models)
      ? productData.item.models.length
      : 0;
    console.log(`Fetching final display prices for ${modelCount} variants...`);

    const item = await fetchVariantPricing(
      page,
      productData.item,
      ids,
      {
        initialPriceBreakdown: productData.initialPriceBreakdown,
      },
    );
    printProduct(item);
  } catch (error) {
    console.error(`Failed to extract product data: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (page && !page.isClosed()) {
      await page.close();
    }

    if (session) {
      await session.close();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TARGET_URL,
  extractShopeeIds,
  formatVnd,
  printProduct,
  toVnd,
  waitForProductData,
};
