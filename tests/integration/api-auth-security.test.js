import { afterEach, describe, expect, it } from 'vitest';

import { cookiePair, createApiHarness, requestJson } from './apiTestUtils.js';
import { loadValidSnapshot } from './databaseTestUtils.js';

const PASSWORD = 'Unique passphrase for tracker 2026!';
const harnesses = new Set();

afterEach(async () => {
  await Promise.all([...harnesses].map((harness) => harness.cleanup()));
  harnesses.clear();
});

async function startApi(options) {
  const harness = await createApiHarness(options);
  harnesses.add(harness);
  return harness;
}

async function register(baseUrl, { clientType = 'dashboard', email = 'owner@example.com' } = {}) {
  return requestJson(baseUrl, '/api/auth/register', {
    body: { clientType, email, password: PASSWORD },
    method: 'POST',
  });
}

describe('API authentication and HTTP security', () => {
  it('provides both health paths, security headers, request IDs, and exact-origin CORS', async () => {
    const { baseUrl } = await startApi();
    const health = await fetch(`${baseUrl}/api/health`, {
      headers: { 'x-request-id': 'phase6-health-check' },
    });

    expect(health.status).toBe(200);
    expect(health.headers.get('x-request-id')).toBe('phase6-health-check');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");

    const legacyHealth = await fetch(`${baseUrl}/health`);
    expect(legacyHealth.status).toBe(200);

    const extensionCors = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'chrome-extension://abcdefghijklmnop' },
    });
    expect(extensionCors.headers.get('access-control-allow-origin')).toBe(
      'chrome-extension://abcdefghijklmnop',
    );

    const rejected = await requestJson(baseUrl, '/api/health', {
      headers: { origin: 'https://attacker.example' },
    });
    expect(rejected.response.status).toBe(403);
    expect(rejected.payload.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('uses the reserved local owner while auth endpoints remain explicitly disabled', async () => {
    const { baseUrl } = await startApi();
    const products = await requestJson(baseUrl, '/api/products');
    expect(products.response.status).toBe(200);

    const login = await requestJson(baseUrl, '/api/auth/login', {
      body: { clientType: 'dashboard', email: 'owner@example.com', password: PASSWORD },
      method: 'POST',
    });
    expect(login.response.status).toBe(403);
    expect(login.payload.error.code).toBe('AUTH_DISABLED');

    const current = await requestJson(baseUrl, '/api/auth/me');
    expect(current.response.status).toBe(403);
    expect(current.payload.error.code).toBe('AUTH_DISABLED');
  });

  it('keeps dashboard tokens out of bodies and rejects a revoked cookie session', async () => {
    const { baseUrl } = await startApi({ allowRegistration: true, authEnabled: true });
    const registered = await register(baseUrl);
    const cookie = cookiePair(registered.response);

    expect(registered.response.status).toBe(201);
    expect(cookie).toMatch(/^price_tracker_session=/u);
    expect(registered.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(registered.response.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(JSON.stringify(registered.payload)).not.toContain('token');

    const current = await requestJson(baseUrl, '/api/auth/me', {
      headers: { cookie },
    });
    expect(current.response.status).toBe(200);
    expect(current.payload.data.user.email).toBe('owner@example.com');

    const logout = await requestJson(baseUrl, '/api/auth/logout', {
      body: {},
      headers: { cookie },
      method: 'POST',
    });
    expect(logout.response.status).toBe(200);
    expect(logout.response.headers.get('set-cookie')).toContain('Max-Age=0');

    const rejected = await requestJson(baseUrl, '/api/products', {
      headers: { cookie },
    });
    expect(rejected.response.status).toBe(401);
    expect(rejected.payload.error.code).toBe('SESSION_REVOKED');
  });

  it('returns extension tokens once and accepts them only as bearer credentials', async () => {
    const { baseUrl } = await startApi({ allowRegistration: true, authEnabled: true });
    const dashboardRegistration = await register(baseUrl);
    expect(dashboardRegistration.response.status).toBe(201);

    const login = await requestJson(baseUrl, '/api/auth/login', {
      body: { clientType: 'extension', email: 'owner@example.com', password: PASSWORD },
      method: 'POST',
    });
    const token = login.payload.data.session.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(login.payload.data.session.transport).toBe('bearer');

    const saved = await requestJson(baseUrl, '/api/products/snapshot', {
      body: loadValidSnapshot(),
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
    });
    expect(saved.response.status).toBe(201);

    const cookieMisuse = await requestJson(baseUrl, '/api/products', {
      headers: { cookie: `price_tracker_session=${token}` },
    });
    expect(cookieMisuse.response.status).toBe(401);
    expect(cookieMisuse.payload.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('protects product routes and enforces owner isolation', async () => {
    const { baseUrl } = await startApi({ allowRegistration: true, authEnabled: true });
    const unauthenticated = await requestJson(baseUrl, '/api/products');
    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.payload.error.code).toBe('AUTHENTICATION_REQUIRED');
    const unauthenticatedQueue = await requestJson(baseUrl, '/api/collection-jobs');
    expect(unauthenticatedQueue.response.status).toBe(401);
    expect(unauthenticatedQueue.payload.error.code).toBe('AUTHENTICATION_REQUIRED');

    const first = await register(baseUrl, {
      clientType: 'extension',
      email: 'first@example.com',
    });
    const second = await register(baseUrl, {
      clientType: 'extension',
      email: 'second@example.com',
    });
    const firstToken = first.payload.data.session.token;
    const secondToken = second.payload.data.session.token;
    const firstSaved = await requestJson(baseUrl, '/api/products/snapshot', {
      body: loadValidSnapshot(),
      headers: { authorization: `Bearer ${firstToken}` },
      method: 'POST',
    });
    const secondSaved = await requestJson(baseUrl, '/api/products/snapshot', {
      body: loadValidSnapshot(),
      headers: { authorization: `Bearer ${secondToken}` },
      method: 'POST',
    });

    const hidden = await requestJson(
      baseUrl,
      `/api/products/${secondSaved.payload.data.product.id}`,
      { headers: { authorization: `Bearer ${firstToken}` } },
    );
    expect(firstSaved.payload.data.product.id).not.toBe(secondSaved.payload.data.product.id);
    expect(hidden.response.status).toBe(404);
    expect(hidden.payload.error.code).toBe('PRODUCT_NOT_FOUND');

    await requestJson(baseUrl, `/api/products/${firstSaved.payload.data.product.id}/refresh`, {
      body: {},
      headers: { authorization: `Bearer ${firstToken}` },
      method: 'POST',
    });
    await requestJson(baseUrl, `/api/products/${secondSaved.payload.data.product.id}/refresh`, {
      body: {},
      headers: { authorization: `Bearer ${secondToken}` },
      method: 'POST',
    });
    const firstQueue = await requestJson(baseUrl, '/api/collection-jobs', {
      headers: { authorization: `Bearer ${firstToken}` },
    });
    const secondQueue = await requestJson(baseUrl, '/api/collection-jobs', {
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(firstQueue.payload.data.jobs.map((job) => job.productId)).toEqual([
      firstSaved.payload.data.product.id,
    ]);
    expect(secondQueue.payload.data.jobs.map((job) => job.productId)).toEqual([
      secondSaved.payload.data.product.id,
    ]);
  });
});
