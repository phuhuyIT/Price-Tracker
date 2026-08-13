import { AUTH_CLIENT_TYPES, ERROR_CODES, SESSION_TRANSPORTS } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

export const DASHBOARD_SESSION_COOKIE = 'price_tracker_session';

function parseCookies(header) {
  const cookies = new Map();

  for (const part of (header ?? '').split(';')) {
    const separatorIndex = part.indexOf('=');

    if (separatorIndex < 1) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

function authenticationRequired() {
  return new AppError({
    code: ERROR_CODES.AUTHENTICATION_REQUIRED,
    message: 'A valid application session is required',
    statusCode: 401,
  });
}

/**
 * Extract either the dashboard cookie or extension bearer credential. A
 * request carrying both is rejected to avoid transport ambiguity.
 */
function extractSessionCredential(request) {
  const authorization = request.get('authorization');
  const cookieToken = parseCookies(request.get('cookie')).get(DASHBOARD_SESSION_COOKIE);
  let bearerToken;

  if (authorization !== undefined) {
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/u);

    if (!match) {
      throw authenticationRequired();
    }

    bearerToken = match[1];
  }

  if ((cookieToken && bearerToken) || (!cookieToken && !bearerToken)) {
    throw authenticationRequired();
  }

  if (bearerToken) {
    return {
      clientType: AUTH_CLIENT_TYPES.EXTENSION,
      token: bearerToken,
      transport: SESSION_TRANSPORTS.BEARER,
    };
  }

  return {
    clientType: AUTH_CLIENT_TYPES.DASHBOARD,
    token: cookieToken,
    transport: SESSION_TRANSPORTS.COOKIE,
  };
}

/**
 * Resolve trusted product ownership in enabled or disabled auth mode.
 */
export function createOwnershipMiddleware({ authenticationService, authConfig }) {
  return function ownership(request, _response, next) {
    try {
      const credential = authConfig.enabled ? extractSessionCredential(request) : undefined;
      const user = authenticationService.resolveOwner(credential);
      request.auth = { credential, user };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Require an enabled, valid session for logout and current-user routes.
 */
export function createAuthenticatedSessionMiddleware({ authenticationService, authConfig }) {
  return function authenticatedSession(request, _response, next) {
    try {
      if (!authConfig.enabled) {
        throw new AppError({
          code: ERROR_CODES.AUTH_DISABLED,
          message: 'Application authentication is disabled',
          statusCode: 403,
        });
      }

      const credential = extractSessionCredential(request);
      const current = authenticationService.getCurrentUser(credential);
      request.auth = { credential, ...current };
      next();
    } catch (error) {
      next(error);
    }
  };
}
