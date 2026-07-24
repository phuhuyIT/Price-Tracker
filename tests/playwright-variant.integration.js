const assert = require("node:assert/strict");
const http = require("node:http");

const { chromium } = require("playwright");

const { fetchVariantPricing } = require("../variant-pricing");

function createMockServer() {
  let activeVariantRequests = 0;
  let maxConcurrentVariantRequests = 0;
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/product-i.10.20") {
      const body = `<!doctype html>
        <title>Mock Shopee product</title>
        <button class="product-variation" data-option="0">First</button>
        <button class="product-variation" data-option="1">Second</button>
        <script>
          for (const button of document.querySelectorAll(".product-variation")) {
            button.addEventListener("click", () => {
              fetch("/api/v4/pdp/cart_panel/select_variation_pc", {
                body: JSON.stringify({
                  item_id: 20,
                  quantity: 1,
                  selected_tiers: { "0": Number(button.dataset.option) },
                  shop_id: 10
                }),
                headers: {
                  "Content-Type": "application/json",
                  "x-api-source": "pc",
                  "x-ui-generated": "1"
                },
                method: "POST"
              });
            });
          }
        </script>`;
      response.writeHead(200, {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(body);
      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/api/v4/pdp/cart_panel/select_variation_pc"
    ) {
      const chunks = [];

      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        activeVariantRequests += 1;
        maxConcurrentVariantRequests = Math.max(
          maxConcurrentVariantRequests,
          activeVariantRequests,
        );
        const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requests.push({
          body: requestBody,
          headers: request.headers,
        });
        const uiGenerated = request.headers["x-ui-generated"] === "1";
        const body = JSON.stringify(
          uiGenerated
            ? {
                data: {
                  price_breakdown: {
                    price: {
                      singlevalue:
                        requestBody.selected_tiers["0"] === 0
                          ? 5_500_000
                          : 6_500_000,
                    },
                  },
                },
              }
            : {
                error: 90309999,
                error_msg: "Missing per-request browser signature",
              },
        );

        setTimeout(() => {
          response.writeHead(uiGenerated ? 200 : 403, {
            "Content-Length": Buffer.byteLength(body),
            "Content-Type": "application/json; charset=utf-8",
          });
          response.end(body);
          activeVariantRequests -= 1;
        }, 500);
      });
      return;
    }

    response.writeHead(404);
    response.end();
  });

  return {
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve(server.address().port);
        });
      });
    },
    get maxConcurrentVariantRequests() {
      return maxConcurrentVariantRequests;
    },
    requests,
  };
}

async function main() {
  const mockServer = createMockServer();
  const port = await mockServer.listen();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/product-i.10.20`);

    const item = {
      models: [
        {
          extinfo: { tier_index: [0] },
          modelid: 1001,
          name: "First",
          price: 7_000_000,
          price_before_discount: 8_000_000,
        },
        {
          extinfo: { tier_index: [1] },
          modelid: 1002,
          name: "Second",
          price: 8_000_000,
          price_before_discount: 9_000_000,
        },
      ],
    };
    const enrichedItem = await fetchVariantPricing(
      page,
      item,
      { itemId: "20", shopId: "10" },
    );

    assert.equal(enrichedItem.variant_pricing.length, 2);
    assert.equal(
      enrichedItem.variant_pricing[0].final_display_price,
      5_500_000,
    );
    assert.equal(
      enrichedItem.variant_pricing[1].final_display_price,
      6_500_000,
    );
    assert.equal(mockServer.requests.length, 2);
    assert.equal(mockServer.requests[0].headers["x-api-source"], "pc");
    assert.equal(mockServer.requests[0].headers["x-ui-generated"], "1");
    assert.equal(mockServer.requests[0].body.item_id, 20);
    assert.equal(mockServer.requests[0].body.shop_id, 10);
    assert.equal(mockServer.maxConcurrentVariantRequests, 1);
    console.log("Playwright variant-pricing integration passed");
  } finally {
    if (browser) {
      await browser.close();
    }

    await mockServer.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
