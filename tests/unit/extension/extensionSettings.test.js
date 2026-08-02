import { describe, expect, it } from 'vitest';

import {
  backendPermissionOrigin,
  createPricingContextKey,
  normaliseBackendBaseUrl,
  normaliseExtensionSettings,
} from '../../../apps/extension/lib/extensionSettings.js';

describe('extension settings', () => {
  it('keeps automatic capture off by default and generates an opaque context key', () => {
    const settings = normaliseExtensionSettings({}, { randomUuid: () => 'fixed-uuid' });

    expect(settings).toEqual({
      automaticCapture: false,
      backendBaseUrl: 'http://127.0.0.1:3000',
      debugMode: false,
      pricingContextKey: 'extension:fixed-uuid',
    });
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
