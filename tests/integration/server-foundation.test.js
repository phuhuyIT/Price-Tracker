import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../apps/server/src/app.js';

const servers = new Set();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            servers.delete(server);
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
    ),
  );
});

async function startServer() {
  const server = createApp().listen(0, '127.0.0.1');
  servers.add(server);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

describe('server foundation', () => {
  it('returns a standard health response', async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        service: 'shopee-price-tracker',
        status: 'ok',
      },
    });
  });

  it('returns a standard route-not-found response', async () => {
    const { baseUrl } = await startServer();
    const response = await fetch(`${baseUrl}/missing`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route not found: GET /missing',
      },
    });
  });
});
