import { describe, expect, it, vi } from 'vitest';

import { createBackendClient } from '../../../apps/extension/lib/backendClient.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('extension backend client product reads', () => {
  it('uses the owner-scoped list/search and detail endpoints with extension authentication', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 4, title: 'Coffee' }],
          meta: { watchlistTotal: 1 },
          success: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { id: 4, title: 'Coffee' }, success: true }));
    const client = createBackendClient(fetchImplementation);
    const settings = { backendBaseUrl: 'https://tracker.example.com' };
    const auth = { mode: 'enabled', token: 'extension-session' };

    const list = await client.listProducts(settings, auth, { limit: 8, search: ' coffee ' });
    const detail = await client.getProduct(settings, auth, 4);

    expect(list).toEqual({
      kind: 'success',
      meta: { watchlistTotal: 1 },
      products: [{ id: 4, title: 'Coffee' }],
    });
    expect(detail).toEqual({ kind: 'success', product: { id: 4, title: 'Coffee' } });
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'https://tracker.example.com/api/products?limit=8&page=1&search=coffee',
      expect.objectContaining({
        headers: { Authorization: 'Bearer extension-session' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      'https://tracker.example.com/api/products/4',
      expect.objectContaining({
        headers: { Authorization: 'Bearer extension-session' },
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
