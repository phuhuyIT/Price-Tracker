import { describe, expect, it } from 'vitest';

import {
  appendQueueRecord,
  calculateRetryDelayMs,
  classifySubmissionFailure,
  MAX_QUEUE_SIZE,
  resetRetryableQueue,
  stableStringify,
} from '../../../apps/extension/lib/submissionQueue.js';

describe('extension submission queue policy', () => {
  it('classifies network, throttling, server, authentication, and validation failures', () => {
    expect(classifySubmissionFailure({ networkError: true })).toBe('temporary');
    expect(classifySubmissionFailure({ status: 429 })).toBe('temporary');
    expect(classifySubmissionFailure({ status: 503 })).toBe('temporary');
    expect(classifySubmissionFailure({ errorCode: 'SESSION_REVOKED', status: 401 })).toBe('auth');
    expect(classifySubmissionFailure({ status: 422 })).toBe('permanent');
  });

  it('uses bounded exponential retry delays', () => {
    expect(calculateRetryDelayMs(1, () => 0)).toBe(1_000);
    expect(calculateRetryDelayMs(3, () => 0)).toBe(4_000);
    expect(calculateRetryDelayMs(20, () => 1)).toBe(60_000);
  });

  it('deduplicates exact records and rejects additions at the queue bound', () => {
    const record = { id: 'one', snapshot: { itemId: '1' } };
    const first = appendQueueRecord([], record);
    const duplicate = appendQueueRecord(first.queue, record);
    const fullQueue = Array.from({ length: MAX_QUEUE_SIZE }, (_, index) => ({ id: String(index) }));

    expect(first.added).toBe(true);
    expect(duplicate).toMatchObject({ added: false, reason: 'duplicate' });
    expect(appendQueueRecord(fullQueue, { id: 'overflow' })).toMatchObject({
      added: false,
      reason: 'queue_full',
    });
  });

  it('resets only retryable or authentication-blocked records', () => {
    const queue = resetRetryableQueue([
      { id: 'auth', state: 'blocked_auth' },
      { id: 'exhausted', state: 'retry_exhausted' },
      { id: 'permanent', state: 'failed_permanent' },
    ]);

    expect(queue.map((item) => item.state)).toEqual(['queued', 'queued', 'failed_permanent']);
  });

  it('creates stable semantic strings regardless of object key order', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
