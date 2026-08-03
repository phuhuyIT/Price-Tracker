import { describe, expect, it } from 'vitest';

import {
  backendPermissionOrigin,
  createPricingContextKey,
  normaliseBackendBaseUrl,
  normaliseExtensionSettings,
} from '../../../apps/extension/lib/extensionSettings.js';

describe('extension settings', () => {
  it('keeps automatic and background collection off with 30-minute polling by default', () => {
    const settings = normaliseExtensionSettings({}, { randomUuid: () => 'fixed-uuid' });

    expect(settings).toEqual({
      automaticCapture: false,
      backendBaseUrl: 'http://127.0.0.1:3000',
      backgroundCollectionEnabled: false,
      collectionPollIntervalMinutes: 30,
      debugMode: false,
      pricingContextKey: 'extension:fixed-uuid',
    });
  });

  it('accepts an explicit bounded background polling interval', () => {
    expect(
      normaliseExtensionSettings({
        backgroundCollectionEnabled: true,
        collectionPollIntervalMinutes: 45,
      }).backgroundCollectionEnabled,
    ).toBe(true);
    expect(
      normaliseExtensionSettings({ collectionPollIntervalMinutes: 45 })
        .collectionPollIntervalMinutes,
    ).toBe(45);
    expect(
      normaliseExtensionSettings({ collectionPollIntervalMinutes: 0 })
        .collectionPollIntervalMinutes,
    ).toBe(30);
  });

  it('accepts loopback HTTP and HTTPS while rejecting remote plaintext backends', () => {
    expect(normaliseBackendBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normaliseBackendBaseUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(normaliseBackendBaseUrl('https://tracker.example.com')).toBe(
      'https://tracker.example.com',
    );
    expect(normaliseBackendBaseUrl('http://tracker.example.com')).toBeNull();
    expect(normaliseBackendBaseUrl('https://tracker.example.com/api')).toBeNull();
  });

  it('requests optional host access only for HTTPS backends', () => {
    expect(backendPermissionOrigin('https://tracker.example.com')).toBe(
      'https://tracker.example.com/*',
    );
    expect(backendPermissionOrigin('http://127.0.0.1:3000')).toBeNull();
  });

  it('creates a schema-compatible context identifier', () => {
    expect(createPricingContextKey(() => '2d6de180-90ca-4a45-878b-05462c31315a')).toMatch(
      /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u,
    );
  });
});
