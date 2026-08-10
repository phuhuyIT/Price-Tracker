import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { waitForProductData } = require('../../../demo.js');

class FakePage extends EventEmitter {}

describe('retained Playwright response cleanup', () => {
  it('removes response and close listeners after a successful capture', async () => {
    const page = new FakePage();
    const result = waitForProductData(page, 1_000);

    expect(page.listenerCount('response')).toBe(1);
    expect(page.listenerCount('close')).toBe(1);

    page.emit('response', {
      json: async () => ({ data: { item: { models: [], title: 'Test product' } } }),
      url: () => 'https://shopee.vn/api/v4/pdp/get_pc',
    });

    await expect(result).resolves.toMatchObject({ item: { title: 'Test product' } });
    expect(page.listenerCount('response')).toBe(0);
    expect(page.listenerCount('close')).toBe(0);
  });

  it('removes listeners and rejects promptly when the page closes', async () => {
    const page = new FakePage();
    const result = waitForProductData(page, 1_000);

    page.emit('close');

    await expect(result).rejects.toThrow('page closed before Shopee product data');
    expect(page.listenerCount('response')).toBe(0);
    expect(page.listenerCount('close')).toBe(0);
  });

  it('removes listeners after a timeout', async () => {
    const page = new FakePage();
    const result = waitForProductData(page, 5);

    await expect(result).rejects.toThrow('Timed out after 0.005 seconds');
    expect(page.listenerCount('response')).toBe(0);
    expect(page.listenerCount('close')).toBe(0);
  });
});
