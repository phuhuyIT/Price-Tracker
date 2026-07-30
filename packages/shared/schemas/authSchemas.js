import { z } from 'zod';

import { AUTH_CLIENT_TYPES, SESSION_TRANSPORTS } from '../constants/contractValues.js';
import {
  emailSchema,
  isoTimestampSchema,
  opaqueSessionTokenSchema,
  passwordSchema,
  positiveSafeIntegerSchema,
} from './commonSchemas.js';
import { authClientTypeSchema, sessionTransportSchema } from './enumSchemas.js';
import { createSuccessResponseSchema, emptyRequestBodySchema } from './apiSchemas.js';

const credentialsRequestFields = {
  clientType: authClientTypeSchema,
  email: emailSchema,
  password: passwordSchema,
};

export const registrationRequestSchema = z.object(credentialsRequestFields).strict();

export const loginRequestSchema = z.object(credentialsRequestFields).strict();

export const logoutRequestSchema = emptyRequestBodySchema;
export const currentUserRequestSchema = emptyRequestBodySchema;

export const userResponseSchema = z
  .object({
    createdAt: isoTimestampSchema,
    email: emailSchema,
    id: positiveSafeIntegerSchema,
  })
  .strict();

const dashboardSessionSchema = z
  .object({
    clientType: z.literal(AUTH_CLIENT_TYPES.DASHBOARD),
    expiresAt: isoTimestampSchema,
    transport: z.literal(SESSION_TRANSPORTS.COOKIE),
  })
  .strict();

const extensionSessionSchema = z
  .object({
    clientType: z.literal(AUTH_CLIENT_TYPES.EXTENSION),
    expiresAt: isoTimestampSchema,
    token: opaqueSessionTokenSchema,
    transport: z.literal(SESSION_TRANSPORTS.BEARER),
  })
  .strict();

export const authenticatedSessionSchema = z.discriminatedUnion('clientType', [
  dashboardSessionSchema,
  extensionSessionSchema,
]);

const dashboardSessionCredentialSchema = z
  .object({
    clientType: z.literal(AUTH_CLIENT_TYPES.DASHBOARD),
    token: opaqueSessionTokenSchema,
    transport: z.literal(SESSION_TRANSPORTS.COOKIE),
  })
  .strict();

const extensionSessionCredentialSchema = z
  .object({
    clientType: z.literal(AUTH_CLIENT_TYPES.EXTENSION),
    token: opaqueSessionTokenSchema,
    transport: z.literal(SESSION_TRANSPORTS.BEARER),
  })
  .strict();

export const sessionRequestSchema = z.discriminatedUnion('clientType', [
  dashboardSessionCredentialSchema,
  extensionSessionCredentialSchema,
]);

export const authDataSchema = z
  .object({
    session: authenticatedSessionSchema,
    user: userResponseSchema,
  })
  .strict();

export const registrationResponseSchema = createSuccessResponseSchema(authDataSchema);
export const loginResponseSchema = createSuccessResponseSchema(authDataSchema);
export const sessionResponseSchema = createSuccessResponseSchema(authDataSchema);

export const sessionSummarySchema = z
  .object({
    clientType: authClientTypeSchema,
    expiresAt: isoTimestampSchema,
    transport: sessionTransportSchema,
  })
  .strict()
  .superRefine((session, context) => {
    const validPair =
      (session.clientType === AUTH_CLIENT_TYPES.DASHBOARD &&
        session.transport === SESSION_TRANSPORTS.COOKIE) ||
      (session.clientType === AUTH_CLIENT_TYPES.EXTENSION &&
        session.transport === SESSION_TRANSPORTS.BEARER);

    if (!validPair) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Session client type and transport do not match',
        path: ['transport'],
      });
    }
  });

export const currentUserResponseSchema = createSuccessResponseSchema(
  z
    .object({
      session: sessionSummarySchema,
      user: userResponseSchema,
    })
    .strict(),
);

export const logoutResponseSchema = createSuccessResponseSchema(
  z
    .object({
      loggedOut: z.literal(true),
    })
    .strict(),
);
