import 'dotenv/config';

import { isIP } from 'node:net';

import { z } from 'zod';

import { ConfigurationError } from '../errors/ConfigurationError.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_PATH: z.string().trim().min(1).default('./data/shopee-tracker.db'),

    AUTH_ENABLED: booleanString.default('false'),
    AUTH_ALLOW_REGISTRATION: booleanString.default('false'),
    AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(8_760).default(720),

    COLLECTION_JOB_LEASE_MS: z.coerce.number().int().min(30_000).max(900_000).default(120_000),

    CRON_ENABLED: booleanString.default('true'),
    CRON_SCHEDULE: z.string().trim().min(1).default('0 */12 * * *'),

    SHOPEE_HEADLESS: booleanString.default('true'),
    SHOPEE_PRICE_SCALE: z.coerce.number().int().positive().safe().default(100_000),

    SCRAPE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(45_000),
    SCRAPE_DELAY_MIN_MS: z.coerce.number().int().min(0).max(300_000).default(5_000),
    SCRAPE_DELAY_MAX_MS: z.coerce.number().int().min(0).max(300_000).default(10_000),
    SCRAPE_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),

    PRICE_DROP_THRESHOLD_PERCENT: z.coerce.number().min(0).max(100).default(1),
    VARIANT_MISSING_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
    MAX_VARIANT_MISSING_RATIO: z.coerce.number().gt(0).max(1).default(0.5),
    VARIANT_MASS_MISSING_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(2),

    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_CHAT_ID: optionalString,

    EXTENSION_ALLOWED_ORIGIN: optionalUrl,
    API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(60),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((value, context) => {
    if (!value.AUTH_ENABLED && !isLoopbackHost(value.HOST)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'HOST must be loopback when AUTH_ENABLED=false',
        path: ['HOST'],
      });
    }

    if (value.SCRAPE_DELAY_MIN_MS > value.SCRAPE_DELAY_MAX_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SCRAPE_DELAY_MIN_MS must not exceed SCRAPE_DELAY_MAX_MS',
        path: ['SCRAPE_DELAY_MIN_MS'],
      });
    }
  });

/**
 * Return whether a hostname or IP address resolves only to the local machine.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const normalisedHost = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');

  if (normalisedHost === 'localhost' || normalisedHost === '::1') {
    return true;
  }

  if (isIP(normalisedHost) === 4) {
    return normalisedHost.startsWith('127.');
  }

  return false;
}

/**
 * Validate environment variables and return immutable application configuration.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment]
 * @returns {Readonly<object>}
 */
export function loadConfig(environment = process.env) {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(result.error.issues);
  }

  const value = result.data;

  return Object.freeze({
    auth: Object.freeze({
      allowRegistration: value.AUTH_ALLOW_REGISTRATION,
      enabled: value.AUTH_ENABLED,
      sessionTtlHours: value.AUTH_SESSION_TTL_HOURS,
    }),
    cron: Object.freeze({
      enabled: value.CRON_ENABLED,
      schedule: value.CRON_SCHEDULE,
    }),
    collection: Object.freeze({
      leaseMs: value.COLLECTION_JOB_LEASE_MS,
    }),
    databasePath: value.DATABASE_PATH,
    environment: value.NODE_ENV,
    extensionAllowedOrigin: value.EXTENSION_ALLOWED_ORIGIN,
    host: value.HOST,
    lifecycle: Object.freeze({
      massMissingConfirmations: value.VARIANT_MASS_MISSING_CONFIRMATIONS,
      maxMissingRatio: value.MAX_VARIANT_MISSING_RATIO,
      missingThreshold: value.VARIANT_MISSING_THRESHOLD,
    }),
    logLevel: value.LOG_LEVEL,
    port: value.PORT,
    priceDropThresholdPercent: value.PRICE_DROP_THRESHOLD_PERCENT,
    rateLimit: Object.freeze({
      max: value.API_RATE_LIMIT_MAX,
      windowMs: value.API_RATE_LIMIT_WINDOW_MS,
    }),
    scrape: Object.freeze({
      delayMaxMs: value.SCRAPE_DELAY_MAX_MS,
      delayMinMs: value.SCRAPE_DELAY_MIN_MS,
      headless: value.SHOPEE_HEADLESS,
      maxRetries: value.SCRAPE_MAX_RETRIES,
      priceScale: value.SHOPEE_PRICE_SCALE,
      timeoutMs: value.SCRAPE_TIMEOUT_MS,
    }),
    telegram: Object.freeze({
      botToken: value.TELEGRAM_BOT_TOKEN,
      chatId: value.TELEGRAM_CHAT_ID,
      enabled: Boolean(value.TELEGRAM_BOT_TOKEN && value.TELEGRAM_CHAT_ID),
    }),
  });
}

export const config = loadConfig();
