import { describe, expect, it } from 'vitest';

import { detectShopeeProductPageAvailability } from '../../../apps/extension/content/pageAvailability.js';

function createElement({ parent = null, tagName = 'DIV', text = '', top = 0 } = {}) {
  const element = {
    hidden: false,
    isConnected: true,
    parentElement: parent,
    tagName,
    textContent: text,
    contains(target) {
      for (let current = target; current; current = current.parentElement) {
        if (current === this) {
          return true;
        }
      }

      return false;
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { top };
    },
    getClientRects() {
      return [{}];
    },
  };

  return element;
}

function createDocument(elements, body, documentElement) {
  return {
    body,
    defaultView: {
      getComputedStyle() {
        return { display: 'block', opacity: '1', visibility: 'visible' };
      },
      innerHeight: 800,
    },
    documentElement,
    querySelectorAll() {
      return elements;
    },
  };
}

describe('Shopee product-page availability fallback', () => {
  it('accepts an exact visible sold-out label in the product detail region', () => {
    const html = createElement({ tagName: 'HTML' });
    const body = createElement({ parent: html, tagName: 'BODY' });
    const app = createElement({ parent: body });
    const productRegion = createElement({ parent: app });
    const soldOut = createElement({ parent: productRegion, text: 'Đã bán hết', top: 120 });
    const title = createElement({
      parent: productRegion,
      tagName: 'H1',
      text: 'Dụng cụ pha cà phê AeroPress - Original',
      top: 180,
    });
    const documentReference = createDocument([app, productRegion, soldOut, title], body, html);

    expect(
      detectShopeeProductPageAvailability(documentReference, {
        title: 'Dụng cụ pha cà phê AeroPress - Original',
      }),
    ).toBe('sold_out');
  });

  it('ignores a sold-out label in a distant recommendation card', () => {
    const html = createElement({ tagName: 'HTML' });
    const body = createElement({ parent: html, tagName: 'BODY' });
    const app = createElement({ parent: body });
    const productRegion = createElement({ parent: app });
    const title = createElement({
      parent: productRegion,
      tagName: 'H1',
      text: 'Available product',
      top: 120,
    });
    const recommendations = createElement({ parent: app });
    const soldOut = createElement({ parent: recommendations, text: 'Đã bán hết', top: 1_400 });
    const documentReference = createDocument(
      [app, productRegion, title, recommendations, soldOut],
      body,
      html,
    );

    expect(
      detectShopeeProductPageAvailability(documentReference, { title: 'Available product' }),
    ).toBe('unknown');
  });

  it('requires the captured product title to be present and visible', () => {
    const html = createElement({ tagName: 'HTML' });
    const body = createElement({ parent: html, tagName: 'BODY' });
    const productRegion = createElement({ parent: body });
    const soldOut = createElement({ parent: productRegion, text: 'Đã bán hết' });
    const documentReference = createDocument([productRegion, soldOut], body, html);

    expect(detectShopeeProductPageAvailability(documentReference, { title: 'Missing title' })).toBe(
      'unknown',
    );
  });
});
