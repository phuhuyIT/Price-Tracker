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

  it('reads a validated owner-scoped collection-job queue', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          jobs: [],
          summary: { claimed: 0, pending: 0, remaining: 0, retryWait: 0, waitingAuth: 0 },
        },
        success: true,
      }),
    );
    const client = createBackendClient(fetchImplementation);
    const settings = { backendBaseUrl: 'https://tracker.example.com' };
    const auth = { mode: 'enabled', token: 'extension-session' };

    const result = await client.listCollectionJobs(settings, auth);

    expect(result).toEqual({
      jobs: [],
      kind: 'success',
      summary: { claimed: 0, pending: 0, remaining: 0, retryWait: 0, waitingAuth: 0 },
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://tracker.example.com/api/collection-jobs',
      expect.objectContaining({
        headers: { Authorization: 'Bearer extension-session' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects an inconsistent collection-job queue response', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          jobs: [],
          summary: { claimed: 0, pending: 1, remaining: 1, retryWait: 0, waitingAuth: 0 },
        },
        success: true,
      }),
    );
    const client = createBackendClient(fetchImplementation);

    await expect(
      client.listCollectionJobs(
        { backendBaseUrl: 'https://tracker.example.com' },
        { mode: 'disabled', token: null },
      ),
    ).resolves.toEqual({
      error: 'Backend returned an invalid collection-job queue',
      errorCode: null,
      kind: 'permanent',
    });
  });
});
