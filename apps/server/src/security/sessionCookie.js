import { DASHBOARD_SESSION_COOKIE } from '../middleware/authentication.js';

function cookieAttributes({ expiresAt, secure }) {
  const attributes = [
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes;
}

/**
 * Serialize a dashboard session token for an HTTP-only same-site cookie.
 */
export function createSessionCookie({ expiresAt, secure, token }) {
  return [
    `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    ...cookieAttributes({ expiresAt, secure }),
  ].join('; ');
}

/**
 * Expire the dashboard session cookie using the same scope and attributes.
 */
export function clearSessionCookie({ secure }) {
  return [
    `${DASHBOARD_SESSION_COOKIE}=`,
    ...cookieAttributes({ expiresAt: 0, secure }),
    'Max-Age=0',
  ].join('; ');
}
