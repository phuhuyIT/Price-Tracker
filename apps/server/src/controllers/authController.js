import { AUTH_CLIENT_TYPES } from '@shopee-price-tracker/shared';

import { clearSessionCookie, createSessionCookie } from '../security/sessionCookie.js';
import { createSuccessResponse } from '../utils/apiResponse.js';

function publicSession(session, sessionToken) {
  const result = {
    clientType: session.clientType,
    expiresAt: session.expiresAt,
    transport: session.transport,
  };

  if (session.clientType === AUTH_CLIENT_TYPES.EXTENSION) {
    result.token = sessionToken;
  }

  return result;
}

function publicAuthData(result) {
  return {
    session: publicSession(result.session, result.sessionToken),
    user: result.user,
  };
}

/**
 * Create authentication HTTP adapters without exposing internal session rows.
 *
 * @param {object} input
 * @param {object} input.authenticationService
 * @param {boolean} input.secureCookies
 */
export function createAuthController({ authenticationService, secureCookies }) {
  function writeNewSession(response, result, statusCode) {
    if (result.session.clientType === AUTH_CLIENT_TYPES.DASHBOARD) {
      response.set(
        'set-cookie',
        createSessionCookie({
          expiresAt: result.session.expiresAt,
          secure: secureCookies,
          token: result.sessionToken,
        }),
      );
    }

    response.status(statusCode).json(createSuccessResponse(publicAuthData(result)));
  }

  return Object.freeze({
    /** Return the current user without returning the credential token. */
    currentUser(request, response) {
      response.json(
        createSuccessResponse({
          session: publicSession(request.auth.session),
          user: request.auth.user,
        }),
      );
    },

    /** Verify credentials and issue the selected session transport. */
    async login(request, response) {
      const result = await authenticationService.login(request.validated.body);
      writeNewSession(response, result, 200);
    },

    /** Revoke the current credential and clear dashboard cookie state. */
    logout(request, response) {
      const result = authenticationService.logout(request.auth.credential);

      if (request.auth.credential.clientType === AUTH_CLIENT_TYPES.DASHBOARD) {
        response.set('set-cookie', clearSessionCookie({ secure: secureCookies }));
      }

      response.json(createSuccessResponse(result));
    },

    /** Create an account and issue its first session. */
    async register(request, response) {
      const result = await authenticationService.register(request.validated.body);
      writeNewSession(response, result, 201);
    },
  });
}
