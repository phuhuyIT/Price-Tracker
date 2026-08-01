import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

/**
 * Attach a validated caller request ID or generate a new UUID.
 */
export function requestId(request, response, next) {
  const suppliedRequestId = request.get('x-request-id');
  const resolvedRequestId =
    suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  request.requestId = resolvedRequestId;
  response.set('x-request-id', resolvedRequestId);
  next();
}
