const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const {
  DEFAULT_TARGET_URL,
  extractShopeeIds,
  printProduct,
} = require("./product");
const {
  mergeVariantPricing,
} = require("./chrome-extension/shared/variant-core");
const {
  createSanitizedFixture,
} = require("./phase1/fixture-sanitizer");

const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_PORT = 3210;
const DEFAULT_BRIDGE_TIMEOUT_MS = 120_000;
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

function getBridgeTimeout() {
  const configuredTimeout = Number(process.env.SHOPEE_BRIDGE_TIMEOUT_MS);

  if (Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
    return configuredTimeout;
  }

  return DEFAULT_BRIDGE_TIMEOUT_MS;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);

  response.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error("The extension response was too large.");
    }

    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body);
}

function createBridge({
  captureEvidence = false,
  modelIds = [],
  onProgress = () => {},
  targetUrl,
  timeoutMs = getBridgeTimeout(),
}) {
  const jobId = crypto.randomUUID();
  const ids = extractShopeeIds(targetUrl);
  let finish;
  let finished = false;
  let timeout;

  const result = new Promise((resolve, reject) => {
    finish = (error, item) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);

      if (error) {
        reject(error);
      } else {
        resolve(item);
      }
    };
  });

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url,
      `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
    );

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/job") {
      sendJson(response, 200, {
        itemId: ids?.itemId,
        jobId,
        modelIds,
        shopId: ids?.shopId,
        targetUrl,
        timeoutMs,
      });
      return;
    }

    if (
      request.method === "POST" &&
      ["/result", "/error", "/progress"].includes(
        requestUrl.pathname,
      )
    ) {
      try {
        const payload = await readJsonBody(request);

        if (payload.jobId !== jobId) {
          sendJson(response, 409, { error: "This job is no longer active." });
          return;
        }

        sendJson(response, 200, { ok: true });

        if (requestUrl.pathname === "/progress") {
          onProgress({
            completed: payload.completed,
            outcome: payload.outcome,
            stage: payload.stage,
            total: payload.total,
          });
        } else if (
          requestUrl.pathname === "/result" &&
          payload.item
        ) {
          const item =
            Array.isArray(payload.variantRequests) &&
            Array.isArray(payload.variantResponses)
              ? {
                  ...payload.item,
                  variant_pricing: mergeVariantPricing(
                    payload.item,
                    payload.variantRequests,
                    payload.variantResponses,
                  ),
                }
              : payload.item;

          finish(
            null,
            captureEvidence
              ? {
                  evidence: {
                    initialPricingPayload:
                      payload.initialPricingPayload ?? null,
                    variantRequests: payload.variantRequests ?? [],
                    variantResponses: payload.variantResponses ?? [],
                  },
                  item,
                }
              : item,
          );
        } else {
          finish(
            new Error(payload.message || "The Chrome extension failed."),
            null,
          );
        }
      } catch (error) {
        sendJson(response, 400, { error: error.message });
      }

      return;
    }

    sendJson(response, 404, { error: "Not found." });
  });

  return {
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }

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
        server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
          server.off("error", reject);
          timeout = setTimeout(() => {
            finish(
              new Error(
                `Timed out after ${timeoutMs / 1000} seconds waiting for the Chrome extension.`,
              ),
              null,
            );
          }, timeoutMs);
          resolve();
        });
      });
    },
    result,
  };
}

function parseArguments(args) {
  let bridgeTimeoutMs = null;
  let fixturePath = null;
  const modelIds = [];
  let targetUrl = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--fixture") {
      fixturePath = args[index + 1];
      index += 1;

      if (!fixturePath) {
        throw new Error("--fixture requires a destination path.");
      }

      continue;
    }

    if (argument === "--timeout") {
      bridgeTimeoutMs = Number(args[index + 1]);
      index += 1;

      if (
        !Number.isSafeInteger(bridgeTimeoutMs) ||
        bridgeTimeoutMs <= 0
      ) {
        throw new Error(
          "--timeout requires a positive integer number of milliseconds.",
        );
      }

      continue;
    }

    if (argument === "--model-id") {
      const modelId = String(args[index + 1] ?? "").trim();
      index += 1;

      if (!/^\d+$/.test(modelId)) {
        throw new Error(
          "--model-id requires a numeric Shopee model ID.",
        );
      }

      modelIds.push(modelId);
      continue;
    }

    if (argument.startsWith("--fixture=")) {
      fixturePath = argument.slice("--fixture=".length);

      if (!fixturePath) {
        throw new Error("--fixture requires a destination path.");
      }

      continue;
    }

    if (argument.startsWith("--timeout=")) {
      bridgeTimeoutMs = Number(
        argument.slice("--timeout=".length),
      );

      if (
        !Number.isSafeInteger(bridgeTimeoutMs) ||
        bridgeTimeoutMs <= 0
      ) {
        throw new Error(
          "--timeout requires a positive integer number of milliseconds.",
        );
      }

      continue;
    }

    if (argument.startsWith("--model-id=")) {
      const modelId = argument.slice("--model-id=".length).trim();

      if (!/^\d+$/.test(modelId)) {
        throw new Error(
          "--model-id requires a numeric Shopee model ID.",
        );
      }

      modelIds.push(modelId);
      continue;
    }

    if (targetUrl) {
      throw new Error(`Unexpected command-line argument: ${argument}`);
    }

    targetUrl = argument;
  }

  return {
    bridgeTimeoutMs,
    fixturePath,
    modelIds: [...new Set(modelIds)],
    targetUrl: targetUrl || DEFAULT_TARGET_URL,
  };
}

async function saveFixture(fixturePath, targetUrl, capture) {
  const absolutePath = path.resolve(fixturePath);
  const fixture = createSanitizedFixture({
    capturedAt: new Date().toISOString(),
    initialPricingPayload: capture.evidence.initialPricingPayload,
    item: capture.item,
    targetUrl,
    variantRequests: capture.evidence.variantRequests,
    variantResponses: capture.evidence.variantResponses,
  });

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(
    absolutePath,
    `${JSON.stringify(fixture, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
    },
  );

  return absolutePath;
}

async function main() {
  let parsedArguments;

  try {
    parsedArguments = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Invalid arguments: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const {
    bridgeTimeoutMs,
    fixturePath,
    modelIds,
    targetUrl,
  } =
    parsedArguments;
  const ids = extractShopeeIds(targetUrl);

  if (!ids) {
    console.error(
      "Invalid Shopee product URL. Expected a URL containing i.<shopId>.<itemId>.",
    );
    process.exitCode = 1;
    return;
  }

  const bridge = createBridge({
    captureEvidence: Boolean(fixturePath),
    modelIds,
    onProgress(progress) {
      if (progress.stage === "product_captured") {
        console.log(
          `Product catalogue captured (${progress.total} models).`,
        );
        return;
      }

      if (
        progress.stage === "variant_collection" &&
        (progress.completed === 1 ||
          progress.completed === progress.total ||
          progress.completed % 5 === 0)
      ) {
        console.log(
          `Variant collection progress: ${progress.completed}/${progress.total} (${progress.outcome}).`,
        );
      }
    },
    targetUrl,
    timeoutMs: bridgeTimeoutMs ?? getBridgeTimeout(),
  });

  try {
    await bridge.listen();
    console.log(
      `Ready for Shopee product (shopId=${ids.shopId}, itemId=${ids.itemId}).`,
    );
    console.log("");
    console.log("1. Focus the Chrome profile/window whose Shopee login you want.");
    console.log('2. Click the "Shopee Price - Current Profile" extension icon.');
    console.log("");
    console.log("Waiting for the extension...");

    const result = await bridge.result;
    const item = fixturePath ? result.item : result;
    printProduct(item);

    if (fixturePath) {
      const savedPath = await saveFixture(fixturePath, targetUrl, result);
      console.log(`Sanitised fixture saved to ${savedPath}`);
    }
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${BRIDGE_PORT} is already in use. Close the other current-profile command and try again.`,
      );
    } else {
      console.error(`Failed to extract product data: ${error.message}`);
    }

    process.exitCode = 1;
  } finally {
    await bridge.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  createBridge,
  getBridgeTimeout,
  parseArguments,
  saveFixture,
};
