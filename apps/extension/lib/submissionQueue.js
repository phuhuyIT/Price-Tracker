import { SUBMISSION_STATES } from './runtimeMessages.js';

export const MAX_QUEUE_SIZE = 50;
export const MAX_RETRY_ATTEMPTS = 5;
export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_DELAY_MS = 60_000;

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

/** Return a bounded exponential delay with small jitter. */
export function calculateRetryDelayMs(attemptCount, random = Math.random) {
  const exponentialDelay = Math.min(1_000 * 2 ** Math.max(0, attemptCount - 1), MAX_RETRY_DELAY_MS);
  return Math.min(exponentialDelay + Math.floor(random() * 500), MAX_RETRY_DELAY_MS);
}

const AUTH_ERROR_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
]);

/** Classify a failed submission without retrying permanent or auth failures. */
export function classifySubmissionFailure({ errorCode, networkError = false, status }) {
  if (networkError) {
    return 'temporary';
  }

  if (status === 401 || AUTH_ERROR_CODES.has(errorCode)) {
    return 'auth';
  }

  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) {
    return 'temporary';
  }

  return 'permanent';
}

/** Add an exact snapshot only once while preserving existing records at the size limit. */
export function appendQueueRecord(queue, record) {
  if (queue.some((item) => item.id === record.id)) {
    return { added: false, queue, reason: 'duplicate' };
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    return { added: false, queue, reason: 'queue_full' };
  }

  return {
    added: true,
    queue: [
      ...queue,
      {
        ...record,
        attemptCount: 0,
        lastError: null,
        nextAttemptAt: Date.now(),
        state: SUBMISSION_STATES.QUEUED,
      },
    ],
    reason: null,
  };
}

/** Mark recoverable queue records pending after an explicit retry or successful sign-in. */
export function resetRetryableQueue(queue, { includeExhausted = true } = {}) {
  return queue.map((item) => {
    const retryable =
      item.state === SUBMISSION_STATES.BLOCKED_AUTH ||
      item.state === SUBMISSION_STATES.RETRY_WAIT ||
      (includeExhausted && item.state === SUBMISSION_STATES.RETRY_EXHAUSTED);

    return retryable
      ? {
          ...item,
          attemptCount: 0,
          lastError: null,
          nextAttemptAt: Date.now(),
          state: SUBMISSION_STATES.QUEUED,
        }
      : item;
  });
}
