importScripts(
  "shared/variant-core.js",
  "shared/variation-page.js",
  "shared/variation-flow.js",
);

const {
  buildTierDefinitions,
  createVariantRequests,
  extractFinalDisplayPrice,
  selectedTiersKey,
  storePreferredResponse,
} = ShopeeVariantCore;
const {
  createVariationClicker,
  findVariationButtonInPage,
} = ShopeeVariationPage;
const { collectVariantResponses } = ShopeeVariationFlow;

const BRIDGE_URL = "http://127.0.0.1:3210";
const CDP_VERSION = "1.3";
const PDP_API_PATH = "/api/v4/pdp/get_pc";
const SELECT_VARIATION_API_FRAGMENT = "/select_variation_";

let running = false;

function wait(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function decodeResponseBody(body, base64Encoded) {
  if (!base64Encoded) {
    return body;
  }

  const bytes = Uint8Array.from(atob(body), (character) =>
    character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

async function setActionStatus(text, color, title) {
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setTitle({ title }),
  ]);
}

function waitForProductData(debuggee, timeoutMs) {
  return new Promise((resolve, reject) => {
    const matchingRequests = new Set();
    const readingRequests = new Set();
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.debugger.onEvent.removeListener(handleEvent);
      chrome.debugger.onDetach.removeListener(handleDetach);
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

    const handleDetach = (source, reason) => {
      if (source.tabId === debuggee.tabId) {
        settle(new Error(`Chrome debugger detached: ${reason}`));
      }
    };

    const handleEvent = async (source, method, params) => {
      if (source.tabId !== debuggee.tabId || settled) {
        return;
      }

      if (
        method === "Network.responseReceived" &&
        params.response?.url?.includes(PDP_API_PATH)
      ) {
        matchingRequests.add(params.requestId);
        return;
      }

      if (
        method !== "Network.loadingFinished" ||
        !matchingRequests.has(params.requestId) ||
        readingRequests.has(params.requestId)
      ) {
        return;
      }

      readingRequests.add(params.requestId);

      try {
        const response = await chrome.debugger.sendCommand(
          debuggee,
          "Network.getResponseBody",
          { requestId: params.requestId },
        );
        const payload = JSON.parse(
          decodeResponseBody(response.body, response.base64Encoded),
        );
        const item = payload?.data?.item;

        if (item) {
          settle(null, {
            initialPriceBreakdown:
              payload?.data?.price_breakdown ??
              payload?.data?.product_price ??
              item.price_breakdown ??
              null,
            item,
          });
        }
      } catch (error) {
        console.warn("Could not read a matching Shopee response:", error);
      } finally {
        matchingRequests.delete(params.requestId);
        readingRequests.delete(params.requestId);
      }
    };

    const timeout = setTimeout(() => {
      settle(
        new Error(
          `Timed out after ${timeoutMs / 1000} seconds waiting for Shopee product data.`,
        ),
      );
    }, timeoutMs);

    chrome.debugger.onEvent.addListener(handleEvent);
    chrome.debugger.onDetach.addListener(handleDetach);
  });
}

async function evaluateInPage(debuggee, functionToCall, argument) {
  const evaluation = await chrome.debugger.sendCommand(
    debuggee,
    "Runtime.evaluate",
    {
      awaitPromise: true,
      expression: `(${functionToCall.toString()})(${JSON.stringify(argument)})`,
      returnByValue: true,
    },
  );

  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ||
        evaluation.exceptionDetails.text ||
        "Could not inspect the product page.",
    );
  }

  return evaluation.result?.value;
}

function createCdpClicker(debuggee) {
  return createVariationClicker({
    async click(x, y) {
      await chrome.debugger.sendCommand(
        debuggee,
        "Input.dispatchMouseEvent",
        {
          button: "left",
          clickCount: 1,
          type: "mousePressed",
          x,
          y,
        },
      );
      await chrome.debugger.sendCommand(
        debuggee,
        "Input.dispatchMouseEvent",
        {
          button: "left",
          clickCount: 1,
          type: "mouseReleased",
          x,
          y,
        },
      );
    },
    locate: (definitions, tierIndex, optionIndex) =>
      evaluateInPage(debuggee, findVariationButtonInPage, {
        definitions,
        optionIndex,
        tierIndex,
      }),
    wait,
  });
}

function createCdpResponseCollector(debuggee) {
  const captured = new Map();
  const trackedRequests = new Map();
  const readingRequests = new Set();

  const handleEvent = (source, method, params) => {
    if (source.tabId !== debuggee.tabId) {
      return;
    }

    if (
      method === "Network.requestWillBeSent" &&
      params.request?.url?.includes(SELECT_VARIATION_API_FRAGMENT)
    ) {
      try {
        const requestBody = JSON.parse(params.request.postData || "");
        const key = selectedTiersKey(requestBody.selected_tiers);

        if (key) {
          trackedRequests.set(params.requestId, {
            key,
            status: null,
          });
        }
      } catch {
        // A request without readable selected_tiers cannot be correlated.
      }

      return;
    }

    if (
      method === "Network.responseReceived" &&
      trackedRequests.has(params.requestId)
    ) {
      trackedRequests.get(params.requestId).status =
        params.response?.status ?? null;
      return;
    }

    if (
      method === "Network.loadingFailed" &&
      trackedRequests.has(params.requestId)
    ) {
      const request = trackedRequests.get(params.requestId);
      storePreferredResponse(captured, request.key, {
        error:
          params.errorText ||
          "The variation-price request failed before completion.",
        ok: false,
        payload: null,
        status: request.status,
      });
      trackedRequests.delete(params.requestId);
      return;
    }

    if (
      method !== "Network.loadingFinished" ||
      !trackedRequests.has(params.requestId) ||
      readingRequests.has(params.requestId)
    ) {
      return;
    }

    readingRequests.add(params.requestId);
    const request = trackedRequests.get(params.requestId);

    chrome.debugger
      .sendCommand(debuggee, "Network.getResponseBody", {
        requestId: params.requestId,
      })
      .then((response) => {
        const responseText = decodeResponseBody(
          response.body,
          response.base64Encoded,
        );
        let payload = null;
        let error = null;

        try {
          payload = JSON.parse(responseText);
        } catch {
          error = `The API returned a non-JSON response (HTTP ${request.status}).`;
        }

        const capturedResponse = {
          error,
          ok:
            request.status !== null &&
            request.status >= 200 &&
            request.status < 300,
          payload,
          status: request.status,
        };

        storePreferredResponse(
          captured,
          request.key,
          capturedResponse,
        );

        if (
          capturedResponse.ok &&
          extractFinalDisplayPrice(payload) === null
        ) {
          console.warn(
            `Shopee variant ${request.key} returned HTTP ${request.status} without a recognized final price.`,
            payload,
          );
        }
      })
      .catch((error) => {
        storePreferredResponse(captured, request.key, {
          error: `Could not read the variation response: ${error.message}`,
          ok: false,
          payload: null,
          status: request.status,
        });
      })
      .finally(() => {
        readingRequests.delete(params.requestId);
        trackedRequests.delete(params.requestId);
      });
  };

  chrome.debugger.onEvent.addListener(handleEvent);

  return {
    captured,
    async stop() {
      chrome.debugger.onEvent.removeListener(handleEvent);

      while (readingRequests.size > 0) {
        await wait(50);
      }
    },
    async waitFor(expectedKeys, timeoutMs) {
      const deadline = Date.now() + timeoutMs;

      while (
        expectedKeys.some((key) => !captured.has(key)) &&
        Date.now() < deadline
      ) {
        await wait(100);
      }
    },
  };
}

async function fetchVariantResponses(debuggee, productData, job) {
  const requests = createVariantRequests(productData.item, {
    itemId: job.itemId,
    shopId: job.shopId,
  });
  const definitions = buildTierDefinitions(productData.item, requests);
  const responses = await collectVariantResponses({
    clicker: createCdpClicker(debuggee),
    collector: createCdpResponseCollector(debuggee),
    definitions,
    initialPriceBreakdown: productData.initialPriceBreakdown,
    requests,
  });

  return { requests, responses };
}

async function requestBridge(pathname, options = {}) {
  const response = await fetch(`${BRIDGE_URL}${pathname}`, {
    cache: "no-store",
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || `The local bridge returned HTTP ${response.status}.`,
    );
  }

  return response;
}

async function fetchJob() {
  const response = await requestBridge("/job");
  return response.json();
}

async function postToBridge(pathname, payload) {
  await requestBridge(pathname, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

async function runJob(sourceTab) {
  if (running) {
    await setActionStatus(
      "BUSY",
      "#f59e0b",
      "A Shopee price job is already running",
    );
    return;
  }

  running = true;
  let debuggee;
  let job;
  let productTab;

  try {
    await setActionStatus("...", "#2563eb", "Connecting to the local script");
    job = await fetchJob();

    if (!Number.isInteger(sourceTab.windowId)) {
      throw new Error("Could not identify the current Chrome window.");
    }

    productTab = await chrome.tabs.create({
      active: true,
      openerTabId: sourceTab.id,
      url: "about:blank",
      windowId: sourceTab.windowId,
    });
    debuggee = { tabId: productTab.id };

    await chrome.debugger.attach(debuggee, CDP_VERSION);
    await chrome.debugger.sendCommand(debuggee, "Network.enable");

    const productDataPromise = waitForProductData(
      debuggee,
      Math.min(job.timeoutMs, 60_000),
    );

    await chrome.tabs.update(productTab.id, {
      url: job.targetUrl,
    });

    const productData = await productDataPromise;
    const variantData = await fetchVariantResponses(
      debuggee,
      productData,
      job,
    );

    await postToBridge("/result", {
      item: productData.item,
      jobId: job.jobId,
      variantRequests: variantData.requests,
      variantResponses: variantData.responses,
    });
    await setActionStatus("OK", "#16a34a", "Shopee price extracted");
  } catch (error) {
    console.error("Shopee price extraction failed:", error);

    if (job) {
      await postToBridge("/error", {
        jobId: job.jobId,
        message: error.message,
      }).catch(() => {});
    }

    await setActionStatus(
      "ERR",
      "#dc2626",
      `Shopee price extraction failed: ${error.message}`,
    );
  } finally {
    if (debuggee) {
      await chrome.debugger.detach(debuggee).catch(() => {});
    }

    if (productTab?.id) {
      await chrome.tabs.remove(productTab.id).catch(() => {});
    }

    running = false;

    setTimeout(() => {
      setActionStatus(
        "",
        "#2563eb",
        "Run Shopee price job in this profile",
      ).catch(() => {});
    }, 5_000);
  }
}

chrome.action.onClicked.addListener(runJob);
