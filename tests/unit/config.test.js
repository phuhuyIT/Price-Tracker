import { describe, expect, it } from 'vitest';

import { isLoopbackHost, loadConfig } from '../../apps/server/src/config/index.js';
import { ConfigurationError } from '../../apps/server/src/errors/ConfigurationError.js';

describe('environment configuration', () => {
  it('uses secure local defaults', () => {
    const result = loadConfig({});

    expect(result.host).toBe('127.0.0.1');
    expect(result.auth).toEqual({
      allowRegistration: false,
      enabled: false,
      sessionTtlHours: 720,
    });
    expect(result.collection).toEqual({
      dispatchDelayMaxMs: 10_000,
      dispatchDelayMinMs: 5_000,
      leaseMs: 300_000,
      maxAttempts: 4,
      retryBaseDelayMs: 5_000,
      retryMaxDelayMs: 300_000,
    });
    expect(result.lifecycle).toEqual({
      massMissingConfirmations: 2,
      maxMissingRatio: 0.5,
      missingThreshold: 3,
    });
  });

  it.each(['127.0.0.1', '127.12.1.8', '::1', '[::1]', 'localhost'])(
    'recognises %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it('rejects a non-loopback bind while authentication is disabled', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ HOST: '192.168.1.10' })).toThrow(
      /HOST must be loopback when AUTH_ENABLED=false/u,
    );
  });

  it('allows a non-loopback bind when authentication is enabled', () => {
    expect(loadConfig({ AUTH_ENABLED: 'true', HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
  });

  it('rejects malformed booleans and lifecycle limits', () => {
    expect(() => loadConfig({ AUTH_ENABLED: 'yes' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ VARIANT_MISSING_THRESHOLD: '0' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ MAX_VARIANT_MISSING_RATIO: '1.1' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ VARIANT_MASS_MISSING_CONFIRMATIONS: '0' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects an inverted scrape delay range', () => {
    expect(() =>
      loadConfig({
        SCRAPE_DELAY_MAX_MS: '5',
        SCRAPE_DELAY_MIN_MS: '10',
      }),
    ).toThrow(/SCRAPE_DELAY_MIN_MS must not exceed SCRAPE_DELAY_MAX_MS/u);
  });

  it('rejects unsafe collection lease durations', () => {
    expect(() => loadConfig({ COLLECTION_JOB_LEASE_MS: '29999' })).toThrow(ConfigurationError);
  });

  it('rejects invalid cron and collection retry configuration', () => {
    expect(() => loadConfig({ CRON_SCHEDULE: 'not a cron expression' })).toThrow(
      /CRON_SCHEDULE must be a valid cron expression/u,
    );
    expect(() =>
      loadConfig({
        COLLECTION_RETRY_BASE_DELAY_MS: '2000',
        COLLECTION_RETRY_MAX_DELAY_MS: '1000',
      }),
    ).toThrow(/COLLECTION_RETRY_BASE_DELAY_MS must not exceed/u);
    expect(() =>
      loadConfig({
        COLLECTION_DISPATCH_DELAY_MAX_MS: '5',
        COLLECTION_DISPATCH_DELAY_MIN_MS: '10',
      }),
    ).toThrow(/COLLECTION_DISPATCH_DELAY_MIN_MS must not exceed/u);
  });
});
