import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiHarness, requestJson } from './apiTestUtils.js';
import { loadValidSnapshot } from './databaseTestUtils.js';

const harnesses = new Set();

afterEach(async () => {
  await Promise.all([...harnesses].map((harness) => harness.cleanup()));
  harnesses.clear();
});

function snapshotWithPrice(priceAmount, day) {
  const snapshot = loadValidSnapshot();
  snapshot.capturedAt = `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  snapshot.variants[0].priceObservation.priceAmount = priceAmount;
  return snapshot;
}

async function startApi(sendMessage = vi.fn(async () => ({ messageId: 1 }))) {
  const telegramClient = { enabled: true, sendMessage, testConnection: vi.fn() };
  const harness = await createApiHarness({
    telegramBotToken: '123456:test-token',
    telegramChatId: '-100123456',
    telegramClient,
  });
  harnesses.add(harness);
  return { ...harness, telegramClient };
}

async function postSnapshot(baseUrl, snapshot) {
  return requestJson(baseUrl, '/api/products/snapshot', {
    body: snapshot,
    method: 'POST',
  });
}

describe('Phase 10 Telegram integration', () => {
  it('sends and records one qualifying transition while suppressing the duplicate cycle', async () => {
    const { baseUrl, databaseHarness, telegramClient } = await startApi();

    await postSnapshot(baseUrl, snapshotWithPrice(250_000, 1));
    const drop = await postSnapshot(baseUrl, snapshotWithPrice(199_000, 2));
    await postSnapshot(baseUrl, snapshotWithPrice(250_000, 3));
    await postSnapshot(baseUrl, snapshotWithPrice(199_000, 4));

    expect(drop.response.status).toBe(201);
    expect(telegramClient.sendMessage).toHaveBeenCalledOnce();
    expect(
      databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM notification_events').get()
        .count,
    ).toBe(1);
  });

  it('does not send a reduction below the product threshold', async () => {
    const { baseUrl, databaseHarness, telegramClient } = await startApi();

    await postSnapshot(baseUrl, snapshotWithPrice(250_000, 1));
    await postSnapshot(baseUrl, snapshotWithPrice(249_000, 2));

    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(
      databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM notification_events').get()
        .count,
    ).toBe(0);
  });

  it('delivers a qualifying alert after a leased scheduled refresh commits', async () => {
    const { baseUrl, databaseHarness, telegramClient } = await startApi();
    const baseline = await postSnapshot(baseUrl, snapshotWithPrice(250_000, 1));
    const productId = baseline.payload.data.product.id;
    const refresh = await requestJson(baseUrl, `/api/products/${productId}/refresh`, {
      body: {},
      method: 'POST',
    });
    const claim = await requestJson(baseUrl, '/api/collection-jobs/claim', {
      body: { pricingContextKey: snapshotWithPrice(199_000, 2).pricingContextKey },
      method: 'POST',
    });
    const completed = await requestJson(
      baseUrl,
      `/api/collection-jobs/${refresh.payload.data.job.id}/complete`,
      {
        body: {
          leaseToken: claim.payload.data.leaseToken,
          snapshot: snapshotWithPrice(199_000, 2),
        },
        method: 'POST',
      },
    );

    expect(completed.response.status).toBe(200);
    expect(completed.payload.data.job.status).toBe('completed');
    expect(telegramClient.sendMessage).toHaveBeenCalledOnce();
    expect(
      databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM notification_events').get()
        .count,
    ).toBe(1);
  });

  it('keeps committed price history when Telegram delivery fails', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('permanent Telegram failure');
    });
    const { baseUrl, databaseHarness } = await startApi(sendMessage);

    await postSnapshot(baseUrl, snapshotWithPrice(250_000, 1));
    const drop = await postSnapshot(baseUrl, snapshotWithPrice(199_000, 2));

    expect(drop.response.status).toBe(201);
    expect(
      databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM price_logs').get().count,
    ).toBe(2);
    expect(
      databaseHarness.database.prepare('SELECT COUNT(*) AS count FROM notification_events').get()
        .count,
    ).toBe(0);
  });
});
