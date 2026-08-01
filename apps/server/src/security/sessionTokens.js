import { createHash, randomBytes } from 'node:crypto';

const SESSION_TOKEN_BYTES = 32;

/**
 * Generate a cryptographically random opaque application-session token.
 *
 * @returns {string}
 */
export function generateSessionToken() {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * Derive the one-way value persisted for an application-session token.
 *
 * @param {string} token
 * @returns {string}
 */
export function hashSessionToken(token) {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}
