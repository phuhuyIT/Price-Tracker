import { chromium } from 'playwright';

import { config } from '../apps/server/src/config/index.js';
import { logger } from '../apps/server/src/logging/logger.js';

const inputUrl = process.argv[2];

if (!inputUrl) {
  throw new Error('Usage: npm run collector:manual -- <https://shopee.vn/product-url>');
}

const productUrl = new URL(inputUrl);
const isShopeeVietnam =
  productUrl.protocol === 'https:' &&
  (productUrl.hostname === 'shopee.vn' || productUrl.hostname.endsWith('.shopee.vn'));

if (!isShopeeVietnam) {
  throw new Error('The manual anonymous collector check accepts only HTTPS Shopee Vietnam URLs');
}

let browser;
let context;
let page;
const startedAt = Date.now();

try {
  browser = await chromium.launch({ headless: config.scrape.headless });
  context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(config.scrape.timeoutMs);

  await page.goto(productUrl.href, {
    timeout: config.scrape.timeoutMs,
    waitUntil: 'domcontentloaded',
  });

  logger.info(
    {
      duration: Date.now() - startedAt,
      finalHost: new URL(page.url()).hostname,
      title: await page.title(),
    },
    'Anonymous Playwright connectivity check completed',
  );
} finally {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
