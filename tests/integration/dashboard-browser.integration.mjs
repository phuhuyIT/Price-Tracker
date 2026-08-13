import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright';

import { createApp } from '../../apps/server/src/app.js';
import { loadConfig } from '../../apps/server/src/config/index.js';
import { openDatabase } from '../../apps/server/src/db/connection.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { createPasswordHasher } from '../../apps/server/src/security/passwordHasher.js';

const silentLogger = { error() {}, info() {}, warn() {} };

function testPasswordHasher() {
  return createPasswordHasher({
    parameters: {
      keyLength: 32,
      maxmem: 8 * 1024 * 1024,
      N: 2 ** 10,
      p: 1,
      r: 8,
      saltLength: 16,
    },
  });
}

async function startDashboard({ allowRegistration = false, authEnabled = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'shopee-dashboard-browser-'));
  const databasePath = join(directory, 'dashboard.db');
  const database = openDatabase(databasePath);
  runMigrations(database);
  const applicationConfig = loadConfig({
    AUTH_ALLOW_REGISTRATION: String(allowRegistration),
    AUTH_ENABLED: String(authEnabled),
    CRON_ENABLED: 'false',
    DATABASE_PATH: databasePath,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
  });
  const server = createApp({
    applicationConfig,
    applicationLogger: silentLogger,
    database,
    passwordHasher: testPasswordHasher(),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      database.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

async function verifyLocalDashboard(browser) {
  const harness = await startDashboard();

  try {
    const snapshot = JSON.parse(
      readFileSync(new URL('../fixtures/valid-product-snapshot.json', import.meta.url), 'utf8'),
    );
    const snapshotResponse = await globalThis.fetch(`${harness.baseUrl}/api/products/snapshot`, {
      body: JSON.stringify(snapshot),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(snapshotResponse.status, 201);
    const snapshotPayload = await snapshotResponse.json();

    const soldOutSnapshot = structuredClone(snapshot);
    soldOutSnapshot.shopId = '567729839';
    soldOutSnapshot.itemId = '41152313937';
    soldOutSnapshot.title = 'AeroPress Original Coffee Maker';
    soldOutSnapshot.canonicalUrl = 'https://shopee.vn/aeropress-original-i.567729839.41152313937';
    soldOutSnapshot.variants = soldOutSnapshot.variants.map((variant, index) => ({
      ...variant,
      availability: 'sold_out',
      modelId: `33000000000${index + 1}`,
      name: index === 0 ? 'Limited Collector Pack' : 'Standard Pack',
      stockQuantity: 0,
    }));
    const soldOutResponse = await globalThis.fetch(`${harness.baseUrl}/api/products/snapshot`, {
      body: JSON.stringify(soldOutSnapshot),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(soldOutResponse.status, 201);
    const queueResponse = await globalThis.fetch(
      `${harness.baseUrl}/api/products/${snapshotPayload.data.product.id}/refresh`,
      {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    assert.equal(queueResponse.status, 202);
    const queued = await queueResponse.json();

    const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#dashboard-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#auth-view').isHidden(), true);
    const cards = page.locator('.product-card');
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.product-card').length === 2,
    );
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.queue-item').length === 1,
    );
    assert.match(await page.locator('.queue-item').textContent(), new RegExp(snapshot.title, 'u'));
    assert.match(await page.locator('.queue-item').textContent(), /Queued/u);

    const claimResponse = await globalThis.fetch(`${harness.baseUrl}/api/collection-jobs/claim`, {
      body: JSON.stringify({ pricingContextKey: snapshot.pricingContextKey }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(claimResponse.status, 200);
    const claim = await claimResponse.json();
    assert.equal(claim.data.job.id, queued.data.job.id);
    await page.locator('#queue-reload-button').click();
    await page.getByText('Collecting', { exact: true }).waitFor({ state: 'visible' });

    const refreshedSnapshot = structuredClone(snapshot);
    refreshedSnapshot.capturedAt = '2026-07-31T10:00:00.000Z';
    refreshedSnapshot.variants[0].priceObservation.priceAmount = 179_000;
    const completeResponse = await globalThis.fetch(
      `${harness.baseUrl}/api/collection-jobs/${claim.data.job.id}/complete`,
      {
        body: JSON.stringify({ leaseToken: claim.data.leaseToken, snapshot: refreshedSnapshot }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    assert.equal(completeResponse.status, 200);
    await page.locator('#queue-reload-button').click();
    await page.locator('#queue-empty').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#queue-count').textContent(), '0');

    const card = cards.filter({ hasText: snapshot.title });
    assert.match(await card.textContent(), /Current lowest price/u);
    assert.match(await card.textContent(), /Price not observed/u);
    assert.match(await card.textContent(), /Stock 12/u);

    await page.getByLabel('Search tracked products').fill('Limited Collector Pack');
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.product-card').length === 1,
    );
    assert.match(await cards.first().textContent(), /AeroPress Original Coffee Maker/u);
    assert.match(await cards.first().textContent(), /Stock 0/u);

    await page.locator('#clear-watchlist-filters').click();
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.product-card').length === 2,
    );
    await page.locator('#watchlist-availability').selectOption('sold_out');
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.product-card').length === 1,
    );
    assert.match(await cards.first().textContent(), /AeroPress Original Coffee Maker/u);
    await page.locator('#clear-watchlist-filters').click();
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.product-card').length === 2,
    );

    await card.getByRole('button', { name: 'History' }).click();
    await page.locator('#chart-shell').waitFor({ state: 'visible' });
    const chartState = await page.evaluate(() => {
      const chart = globalThis.Chart.getChart(globalThis.document.querySelector('#history-chart'));
      const observedPrices = chart?.data.datasets.flatMap((dataset) =>
        dataset.data.filter((point) => point.y !== null).map((point) => point.y),
      );

      return {
        datasetCount: chart?.data.datasets.length,
        containsGap: chart?.data.datasets.some((dataset) =>
          dataset.data.some((point) => point.y === null),
        ),
        dateTickCount: chart?.scales.x.ticks.length,
        datesAreVisible: chart?.scales.x.ticks.every((tick) => tick.label !== 'Never'),
        lowestObservedPrice: Math.min(...observedPrices),
        lowestParsedPrice: Math.min(
          ...chart
            .getSortedVisibleDatasetMetas()
            .flatMap((metadata) =>
              metadata._parsed.filter((point) => point.y !== null).map((point) => point.y),
            ),
        ),
        spanGaps: chart?.data.datasets.every((dataset) => dataset.spanGaps === false),
        yScaleIncludesLowestPrice: chart?.scales.y.min <= Math.min(...observedPrices),
      };
    });
    assert.deepEqual(chartState, {
      containsGap: true,
      datasetCount: 2,
      dateTickCount: 2,
      datesAreVisible: true,
      lowestObservedPrice: 179_000,
      lowestParsedPrice: 179_000,
      spanGaps: true,
      yScaleIncludesLowestPrice: true,
    });

    await page.getByRole('button', { name: 'Close' }).click();
    await card.getByRole('button', { name: 'Pause' }).click();
    await card.getByText('Paused', { exact: true }).waitFor({ state: 'visible' });
    await page.locator('#watchlist-status').selectOption('paused');
    await page.waitForFunction(
      () => globalThis.document.querySelectorAll('.product-card').length === 1,
    );
    assert.match(await cards.first().textContent(), new RegExp(snapshot.title, 'u'));
    assert.deepEqual(pageErrors, []);
    await page.close();
  } finally {
    await harness.cleanup();
  }
}

async function verifyAuthenticatedDashboard(browser) {
  const harness = await startDashboard({ allowRegistration: true, authEnabled: true });

  try {
    const page = await browser.newPage({ viewport: { height: 800, width: 1100 } });
    const email = 'dashboard@example.com';
    const password = 'Correct horse battery 2026!';
    await page.goto(harness.baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-view').waitFor({ state: 'visible' });

    await page.getByRole('tab', { name: 'Create account' }).click();
    const registrationForm = page.locator('#register-form');
    await registrationForm.getByLabel('Email').fill(email);
    await registrationForm.getByLabel('Password').fill(password);
    await registrationForm.getByRole('button', { name: 'Create account' }).click();
    await Promise.race([
      page.locator('#dashboard-view').waitFor({ state: 'visible' }),
      registrationForm
        .locator('[data-form-error]')
        .waitFor({ state: 'visible' })
        .then(async () => {
          throw new Error(await registrationForm.locator('[data-form-error]').textContent());
        }),
    ]);
    assert.equal(await page.locator('#account-email').textContent(), email);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.locator('#auth-view').waitFor({ state: 'visible' });
    const loginForm = page.locator('#login-form');
    await loginForm.getByLabel('Email').fill(email);
    await loginForm.getByLabel('Password').fill(password);
    await loginForm.getByRole('button', { name: 'Sign in' }).click();
    await page.locator('#dashboard-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#account-email').textContent(), email);
    await page.close();
  } finally {
    await harness.cleanup();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  await verifyLocalDashboard(browser);
  await verifyAuthenticatedDashboard(browser);
  process.stdout.write('Dashboard browser integration passed\n');
} finally {
  await browser.close();
}
