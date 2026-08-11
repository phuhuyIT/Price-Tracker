import { describe, expect, it } from 'vitest';

import { isTrustedExtensionPageSender } from '../../../apps/extension/lib/messageSender.js';

const RUNTIME_ID = 'nhhlnaokdgoclelapceeojkghegnoihg';

describe('extension UI message sender validation', () => {
  it('accepts the extension popup', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: RUNTIME_ID,
          url: `chrome-extension://${RUNTIME_ID}/popup/popup.html`,
        },
        RUNTIME_ID,
      ),
    ).toBe(true);
  });

  it('accepts the extension options page when Chrome opens it in a tab', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: RUNTIME_ID,
          tab: { id: 42, url: `chrome-extension://${RUNTIME_ID}/options/options.html` },
          url: `chrome-extension://${RUNTIME_ID}/options/options.html`,
        },
        RUNTIME_ID,
      ),
    ).toBe(true);
  });

  it('rejects a content script even though it has the same extension ID', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: RUNTIME_ID,
          tab: { id: 42, url: 'https://shopee.vn/product-i.1.2' },
          url: 'https://shopee.vn/product-i.1.2',
        },
        RUNTIME_ID,
      ),
    ).toBe(false);
  });

  it('rejects another extension and malformed sender URLs', () => {
    expect(
      isTrustedExtensionPageSender(
        {
          id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/options/options.html',
        },
        RUNTIME_ID,
      ),
    ).toBe(false);
    expect(isTrustedExtensionPageSender({ id: RUNTIME_ID, url: 'not a url' }, RUNTIME_ID)).toBe(
      false,
    );
    expect(isTrustedExtensionPageSender({ id: RUNTIME_ID }, RUNTIME_ID)).toBe(false);
  });
});
