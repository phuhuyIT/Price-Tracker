import express from 'express';

import {
  emptyRequestBodySchema,
  loginRequestSchema,
  registrationRequestSchema,
} from '@shopee-price-tracker/shared';

import { createAuthController } from '../controllers/authController.js';
import { createAuthenticatedSessionMiddleware } from '../middleware/authentication.js';
import { createAuthenticationRateLimit } from '../middleware/rateLimit.js';
import { validateRequest } from '../middleware/validateRequest.js';

/** Create application-authentication routes. */
export function createAuthRoutes({ applicationConfig, services }) {
  const router = express.Router();
  const controller = createAuthController({
    authenticationService: services.authentication,
    secureCookies: applicationConfig.environment === 'production',
  });
  const authRateLimit = createAuthenticationRateLimit(applicationConfig.rateLimit);
  const requireSession = createAuthenticatedSessionMiddleware({
    authConfig: applicationConfig.auth,
    authenticationService: services.authentication,
  });

  router.post(
    '/register',
    authRateLimit,
    validateRequest({ body: registrationRequestSchema }),
    controller.register,
  );
  router.post(
    '/login',
    authRateLimit,
    validateRequest({ body: loginRequestSchema }),
    controller.login,
  );
  router.post(
    '/logout',
    requireSession,
    validateRequest({ body: emptyRequestBodySchema }),
    controller.logout,
  );
  router.get('/me', requireSession, controller.currentUser);

  return router;
}
