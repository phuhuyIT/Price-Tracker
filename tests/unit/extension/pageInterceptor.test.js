import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { installPageInterceptor } from '../../../apps/extension/content/page-interceptor.js';

describe('page interceptor', () => {
  it('returns the original fetch response while inspecting only a cloned payload', async () => {
    const sourceFixture = JSON.parse(
      await readFile(
        new URL('../../fixtures/shopee-multi-variant-user-session.json', import.meta.url),
        'utf8',
      ),
    );
    const rawPayload = sourceFixture.endpointEvidence.productDetail.response;
    const response = {
      clone: vi.fn(() => ({ json: vi.fn(async () => rawPayload) })),
      ok: true,
      status: 200,
      url: 'https://shopee.vn/api/v4/pdp/get_pc?item_id=26882883164',
    };
    const originalFetch = vi.fn(async () => response);
    const postMessage = vi.fn();
    const target = {
      fetch: originalFetch,
      location: {
        href: sourceFixture.sourceUrl,
        origin: 'https://shopee.vn',
      },
      postMessage,
    };

    installPageInterceptor(target);
    const result = await target.fetch(response.url);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());

    expect(result).toBe(response);
    expect(response.clone).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      endpoint: '/api/v4/pdp/get_pc',
      kind: 'product_detail',
      type: 'SHOPEE_PRICE_TRACKER_CAPTURE',
    });
    expect(postMessage.mock.calls[0][1]).toBe('https://shopee.vn');
  });

  it('does not clone or inspect unrelated responses', async () => {
    const response = {
      clone: vi.fn(),
      ok: true,
      status: 200,
      url: 'https://shopee.vn/api/v4/search/search_items',
    };
    const target = {
      fetch: vi.fn(async () => response),
      location: { href: 'https://shopee.vn/', origin: 'https://shopee.vn' },
      postMessage: vi.fn(),
    };

    installPageInterceptor(target);
    expect(await target.fetch(response.url)).toBe(response);
    await Promise.resolve();

    expect(response.clone).not.toHaveBeenCalled();
    expect(target.postMessage).not.toHaveBeenCalled();
  });

  it('emits only a typed authentication status for Shopee error 90309999', async () => {
    const response = {
      clone: vi.fn(() => ({ json: vi.fn(async () => ({ error: 90_309_999 })) })),
      ok: true,
      status: 200,
      url: 'https://shopee.vn/api/v4/pdp/get_pc?item_id=26882883164',
    };
    const target = {
      fetch: vi.fn(async () => response),
      location: {
        href: 'https://shopee.vn/product-i.1259293184.26882883164',
        origin: 'https://shopee.vn',
      },
      postMessage: vi.fn(),
    };

    installPageInterceptor(target);
    await target.fetch(response.url);
    await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledOnce());

    expect(target.postMessage.mock.calls[0][0]).toEqual({
      capturedAt: expect.any(String),
      code: 'AUTHENTICATION_REQUIRED',
      protocolVersion: 1,
      type: 'SHOPEE_PRICE_TRACKER_COLLECTION_STATUS',
    });
  });

  it('classifies a Shopee 5xx response without changing the response', async () => {
    const response = {
      clone: vi.fn(() => ({ json: vi.fn(async () => ({})) })),
      ok: false,
      status: 503,
      url: 'https://shopee.vn/api/v4/pdp/get_pc?item_id=26882883164',
    };
    const target = {
      fetch: vi.fn(async () => response),
      location: {
        href: 'https://shopee.vn/product-i.1259293184.26882883164',
        origin: 'https://shopee.vn',
      },
      postMessage: vi.fn(),
    };

    installPageInterceptor(target);
    await expect(target.fetch(response.url)).resolves.toBe(response);
    await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledOnce());

    expect(target.postMessage.mock.calls[0][0]).toMatchObject({
      code: 'SHOPEE_SERVER_ERROR',
      type: 'SHOPEE_PRICE_TRACKER_COLLECTION_STATUS',
    });
  });

  it('reports a matching fetch failure and preserves the original rejection', async () => {
    const networkError = new TypeError('Failed to fetch');
    const target = {
      fetch: vi.fn(async () => {
        throw networkError;
      }),
      location: {
        href: 'https://shopee.vn/product-i.1259293184.26882883164',
        origin: 'https://shopee.vn',
      },
      postMessage: vi.fn(),
    };

    installPageInterceptor(target);
    await expect(
      target.fetch('https://shopee.vn/api/v4/pdp/get_pc?item_id=26882883164'),
    ).rejects.toBe(networkError);

    expect(target.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FETCH_FAILED',
        type: 'SHOPEE_PRICE_TRACKER_COLLECTION_STATUS',
      }),
      'https://shopee.vn',
    );
  });
});
