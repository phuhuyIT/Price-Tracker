const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

const { chromium } = require("playwright");

const { createBridge } = require("../current-profile");

const MOCK_HOST = "127.0.0.1";
const MOCK_PORT = 3211;

function startMockShopee() {
  const variantRequests = [];
  const server = http.createServer((request, response) => {
    if (request.url === "/product-i.1.2") {
      const body = `<!doctype html>
        <button class="product-variation" data-tier="0" data-option="0">Red</button>
        <button class="product-variation" data-tier="0" data-option="1">Blue</button>
        <button class="product-variation" data-tier="1" data-option="0">Small</button>
        <button class="product-variation" data-tier="1" data-option="1">Large</button>
        <script>
          const selectedTiers = { "0": 0, "1": 0 };
          fetch("/api/v4/pdp/get_pc").then(response => response.json());

          for (const button of document.querySelectorAll(".product-variation")) {
            button.addEventListener("click", () => {
              selectedTiers[button.dataset.tier] = Number(button.dataset.option);
              fetch("/api/v4/pdp/cart_panel/select_variation_pc", {
                body: JSON.stringify({
                  item_id: 2,
                  quantity: 1,
                  selected_tiers: { ...selectedTiers },
                  shop_id: 1
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

    if (request.url === "/api/v4/pdp/get_pc") {
      const body = JSON.stringify({
        data: {
          item: {
            models: [
              {
                extinfo: { tier_index: [0, 1] },
                modelid: 101,
                name: "Red, Large",
                price: 10_000_000,
                price_before_discount: 12_000_000,
              },
              {
                extinfo: { tier_index: [1, 0] },
                modelid: 102,
                name: "Blue, Small",
                price: 11_000_000,
                price_before_discount: 13_000_000,
              },
            ],
            price_max: 200_000,
            price_min: 100_000,
            title: "Current profile integration test",
          },
        },
      });
      response.writeHead(200, {
        "Content-Length": Buffer.byteLength(body),
        "Content-Type": "application/json; charset=utf-8",
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
        const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        variantRequests.push(requestBody);
        const isFirstVariant =
          requestBody.selected_tiers["0"] === 0 &&
          requestBody.selected_tiers["1"] === 1;
        const uiGenerated = request.headers["x-ui-generated"] === "1";
        const payload = uiGenerated
          ? isFirstVariant
            ? {
                data: {
                  price_breakdown: {
                    price: { singlevalue: 7_500_000 },
                  },
                },
              }
            : {
                data: {
                  product_price: {
                    price: { single_value: 8_500_000 },
                  },
                },
              }
          : {
              error: 90309999,
              error_msg: "Missing per-request browser signature",
            };
        const body = JSON.stringify(payload);

        response.writeHead(uiGenerated ? 200 : 403, {
          "Content-Length": Buffer.byteLength(body),
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(body);
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
        server.listen(MOCK_PORT, MOCK_HOST, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    variantRequests,
  };
}

async function main() {
  const targetUrl = `http://${MOCK_HOST}:${MOCK_PORT}/product-i.1.2`;
  const bridge = createBridge({ targetUrl, timeoutMs: 15_000 });
  const mockShopee = startMockShopee();
  let context;

  try {
    await Promise.all([bridge.listen(), mockShopee.listen()]);

    const extensionPath = path.join(__dirname, "..", "chrome-extension");
    context = await chromium.launchPersistentContext("", {
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
      channel: "chromium",
      headless: true,
    });

    let worker = context.serviceWorkers()[0];

    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    }

    const sourcePage = await context.newPage();
    await sourcePage.goto("data:text/html,<title>source-profile-tab</title>");

    const sourceWindowId = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      runJob(tab);
      return tab.windowId;
    });

    const productPage = await context.waitForEvent("page");
    const productWindowId = await worker.evaluate(async (tabUrl) => {
      const tabs = await chrome.tabs.query({});
      const productTab = tabs.find(
        (tab) => tab.pendingUrl === tabUrl || tab.url === tabUrl,
      );
      return productTab?.windowId;
    }, targetUrl);

    assert.equal(productWindowId, sourceWindowId);

    const item = await bridge.result;
    assert.equal(item.title, "Current profile integration test");
    assert.equal(item.variant_pricing.length, 2);
    assert.equal(item.variant_pricing[0].final_display_price, 7_500_000);
    assert.equal(item.variant_pricing[1].final_display_price, 8_500_000);
    assert.deepEqual(item.variant_pricing[0].selected_tiers, {
      0: 0,
      1: 1,
    });
    assert.ok(mockShopee.variantRequests.length >= 2);
    const firstVariantRequest = mockShopee.variantRequests.find(
      (request) =>
        request.selected_tiers["0"] === 0 &&
        request.selected_tiers["1"] === 1,
    );
    assert.equal(firstVariantRequest.item_id, 2);
    assert.equal(firstVariantRequest.shop_id, 1);
    assert.equal(firstVariantRequest.quantity, 1);
    await productPage.waitForEvent("close");

    console.log("Current-profile extension integration passed");
  } finally {
    if (context) {
      await context.close();
    }

    await Promise.all([bridge.close(), mockShopee.close()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
