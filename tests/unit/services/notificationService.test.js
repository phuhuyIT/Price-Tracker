import { describe, expect, it, vi } from 'vitest';

import { createNotificationService } from '../../../apps/server/src/services/notificationService.js';

function trackingResult() {
  return {
    comparisons: [
      {
        comparison: {
          dropPercentage: 20.4,
          shouldNotify: true,
          transition: {
            currency: 'VND',
            currentPriceLogId: 12,
            newPriceAmount: 199_000,
            oldPriceAmount: 250_000,
            ownerUserId: 3,
            previousPriceLogId: 11,
            priceDefinition: 'displayed_post_voucher_excluding_shipping',
            priceType: 'listed',
            pricingContext: 'user_session',
            pricingContextKey: 'extension-context',
            variantId: 8,
          },
        },
        variant: { id: 8, name: '200g <Machine>' },
      },
    ],
    product: {
      canonicalUrl: 'https://shopee.vn/product-i.1.2',
      id: 5,
      title: 'Fine & Robusta',
    },
  };
}

function createHarness({ enabled = true, sendError = null } = {}) {
  let sentNotification = null;
  const repositories = {
    notifications: {
      findTransition: vi.fn(() => sentNotification),
      recordSent: vi.fn((transition) => {
        sentNotification = { ...transition, id: 41 };
        return { created: true, notification: sentNotification };
      }),
    },
  };
  const telegramClient = {
    enabled,
    sendMessage: sendError
      ? vi.fn(async () => {
          throw sendError;
        })
      : vi.fn(async () => ({ messageId: 99 })),
  };
  const notificationLogger = { info: vi.fn(), warn: vi.fn() };
  const service = createNotificationService({
    clock: () => new Date('2026-08-09T12:00:00.000Z'),
    notificationLogger,
    repositories,
    telegramClient,
  });

  return { notificationLogger, repositories, service, telegramClient };
}

describe('price-drop notification service', () => {
  it('serialises duplicate candidates and sends one successful transition', async () => {
    const harness = createHarness();
    const result = trackingResult();
    const [first, duplicate] = await Promise.all([
      harness.service.deliverTrackingResult(result),
      harness.service.deliverTrackingResult(result),
    ]);

    expect(first).toMatchObject({ eligible: 1, sent: 1 });
    expect(duplicate).toMatchObject({ eligible: 1, skipped: 1 });
    expect(harness.telegramClient.sendMessage).toHaveBeenCalledOnce();
    expect(harness.telegramClient.sendMessage.mock.calls[0][0]).toContain('Fine &amp; Robusta');
    expect(harness.repositories.notifications.recordSent).toHaveBeenCalledOnce();
  });

  it('does nothing when Telegram is disabled', async () => {
    const harness = createHarness({ enabled: false });

    await expect(harness.service.deliverTrackingResult(trackingResult())).resolves.toMatchObject({
      disabled: true,
      eligible: 1,
      sent: 0,
    });
    expect(harness.telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(harness.repositories.notifications.recordSent).not.toHaveBeenCalled();
  });

  it('reports delivery failure without recording a successful event', async () => {
    const harness = createHarness({ sendError: new Error('Telegram unavailable') });

    await expect(harness.service.deliverTrackingResult(trackingResult())).resolves.toMatchObject({
      eligible: 1,
      failed: 1,
      sent: 0,
    });
    expect(harness.repositories.notifications.recordSent).not.toHaveBeenCalled();
    expect(harness.notificationLogger.warn).toHaveBeenCalledOnce();
  });
});
