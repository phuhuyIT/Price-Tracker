import { describe, expect, it } from 'vitest';

import {
  escapeTelegramHtml,
  formatTelegramPriceDropMessage,
  formatTelegramVnd,
} from '../../../apps/server/src/services/telegramMessageFormatter.js';

describe('Telegram price-drop formatting', () => {
  it('escapes user-controlled text and includes the complete comparison context', () => {
    const message = formatTelegramPriceDropMessage({
      dropPercentage: 20.44,
      newPriceAmount: 199_000,
      oldPriceAmount: 250_000,
      priceDefinition: 'displayed_post_voucher_excluding_shipping',
      pricingContext: 'user_session',
      productTitle: 'Coffee <b> & "special"',
      productUrl: 'https://shopee.vn/product-i.1.2?one=1&two=2',
      variantName: 'Large > Small',
    });

    expect(message).toContain('Coffee &lt;b&gt; &amp; &quot;special&quot;');
    expect(message).toContain('Large &gt; Small');
    expect(message).toContain('<b>Old price:</b> 250,000 VND');
    expect(message).toContain('<b>New price:</b> 199,000 VND');
    expect(message).toContain('<b>Price reduction:</b> 20.4%');
    expect(message).toContain(
      'Displayed after applicable discounts and vouchers, excluding shipping',
    );
    expect(message).toContain('<b>Pricing context:</b> User session');
    expect(message).toContain('one=1&amp;two=2');
    expect(message).not.toContain('Coffee <b>');
  });

  it('rejects invalid prices and escapes Telegram HTML metacharacters', () => {
    expect(escapeTelegramHtml('<>&"')).toBe('&lt;&gt;&amp;&quot;');
    expect(() => formatTelegramVnd(0)).toThrow(/positive safe integers/u);
  });
});
