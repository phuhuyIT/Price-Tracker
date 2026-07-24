const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const CDP_CONNECT_TIMEOUT_MS = 2_000;
const CHROME_CDP_URL =
  process.env.CHROME_CDP_URL || "http://127.0.0.1:9222";
const CHROME_PROFILE_DIR =
  process.env.CHROME_PROFILE_DIR ||
  path.join(os.homedir(), ".shopee-price", "chrome-profile");

function getRequestedContextIndex(contextCount) {
  const rawIndex = process.env.CHROME_CONTEXT_INDEX;

  if (rawIndex === undefined) {
    return null;
  }

  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0 || index >= contextCount) {
    throw new Error(
      `CHROME_CONTEXT_INDEX must be an integer from 0 to ${contextCount - 1}.`,
    );
  }

  return index;
}

async function scoreChromeContext(context, index) {
  const pages = context.pages();
  let cookies = [];

  try {
    cookies = await context.cookies(["https://shopee.vn"]);
  } catch {
    // Some unusual CDP contexts do not allow cookies to be inspected.
  }

  const hasOpenShopeePage = pages.some((page) =>
    page.url().includes("shopee.vn"),
  );
  const hasShopeeLogin = cookies.some(
    (cookie) =>
      ["SPC_ST", "SPC_U"].includes(cookie.name) &&
      cookie.value &&
      cookie.value !== "0" &&
      cookie.value !== "-",
  );

  return {
    context,
    hasOpenShopeePage,
    hasShopeeLogin,
    index,
    score:
      (hasOpenShopeePage ? 100 : 0) +
      (hasShopeeLogin ? 50 : 0) +
      Math.min(pages.length, 10),
  };
}

async function selectChromeContext(browser) {
  const contexts = browser.contexts();

  if (contexts.length === 0) {
    throw new Error("The connected Chrome browser has no usable contexts.");
  }

  const requestedIndex = getRequestedContextIndex(contexts.length);

  if (requestedIndex !== null) {
    console.log(
      `Using Chrome context ${requestedIndex} of ${contexts.length - 1} (selected by CHROME_CONTEXT_INDEX).`,
    );
    return contexts[requestedIndex];
  }

  const rankedContexts = await Promise.all(
    contexts.map((context, index) => scoreChromeContext(context, index)),
  );

  rankedContexts.sort((left, right) => right.score - left.score);
  const selected = rankedContexts[0];
  const reason = selected.hasOpenShopeePage
    ? "it already has a Shopee tab"
    : selected.hasShopeeLogin
      ? "it has a Shopee login cookie"
      : "it is the best available context";

  console.log(
    `Using Chrome context ${selected.index} of ${contexts.length - 1} because ${reason}.`,
  );

  return selected.context;
}

async function tryConnectingToChrome() {
  let browser;

  try {
    browser = await chromium.connectOverCDP(CHROME_CDP_URL, {
      noDefaults: true,
      timeout: CDP_CONNECT_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  try {
    const context = await selectChromeContext(browser);
    console.log(`Attached to the open Chrome browser at ${CHROME_CDP_URL}.`);

    return {
      close: () => browser.close(),
      context,
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function openBrowserSession() {
  const attachedSession = await tryConnectingToChrome();

  if (attachedSession) {
    return attachedSession;
  }

  console.log(`No debuggable Chrome found at ${CHROME_CDP_URL}.`);
  console.log(`Opening persistent Chrome profile: ${CHROME_PROFILE_DIR}`);
  console.log("Log in once in this window; later runs will reuse the session.");

  const context = await chromium.launchPersistentContext(
    CHROME_PROFILE_DIR,
    {
      channel: "chrome",
      headless: false,
    },
  );

  return {
    close: () => context.close(),
    context,
  };
}

module.exports = {
  getRequestedContextIndex,
  openBrowserSession,
  selectChromeContext,
};
