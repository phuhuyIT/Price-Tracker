import { createApp } from '../../apps/server/src/app.js';
import { loadConfig } from '../../apps/server/src/config/index.js';
import { createPasswordHasher } from '../../apps/server/src/security/passwordHasher.js';
import { createTestDatabase } from './databaseTestUtils.js';

const silentLogger = Object.freeze({
  error() {},
  info() {},
  warn() {},
});

function createClock() {
  let tick = 0;
  const start = Date.parse('2026-08-01T00:00:00.000Z');

  return () => new Date(start + tick++ * 1_000);
}

function createTestPasswordHasher() {
  return createPasswordHasher({
    parameters: {
      keyLength: 32,
      maxmem: 8 * 1024 * 1024,
      N: 2 ** 10,
      p: 1,
      r: 8,
      saltLength: 16,
    },
  });
}

/** Start one isolated migrated API server. */
export async function createApiHarness({
  allowRegistration = false,
  authEnabled = false,
  extensionAllowedOrigin = 'chrome-extension://abcdefghijklmnop',
  rateLimitMax = 1_000,
} = {}) {
  const databaseHarness = createTestDatabase();
  const applicationConfig = loadConfig({
    API_RATE_LIMIT_MAX: String(rateLimitMax),
    AUTH_ALLOW_REGISTRATION: String(allowRegistration),
    AUTH_ENABLED: String(authEnabled),
    CRON_ENABLED: 'false',
    DATABASE_PATH: databaseHarness.databasePath,
    EXTENSION_ALLOWED_ORIGIN: extensionAllowedOrigin,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
  });
  const app = createApp({
    applicationConfig,
    applicationLogger: silentLogger,
    clock: createClock(),
    database: databaseHarness.database,
    passwordHasher: createTestPasswordHasher(),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();

  return {
    applicationConfig,
    baseUrl: `http://127.0.0.1:${address.port}`,
    databaseHarness,
    async cleanup() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      databaseHarness.cleanup();
    },
    server,
  };
}

/** Send a request and parse its standard JSON response. */
export async function requestJson(baseUrl, path, { body, headers = {}, method = 'GET' } = {}) {
  const requestHeaders = { ...headers };
  const options = { headers: requestHeaders, method };

  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json();

  return { payload, response };
}

/** Return only the cookie name/value pair from a Set-Cookie response. */
export function cookiePair(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? null;
}
