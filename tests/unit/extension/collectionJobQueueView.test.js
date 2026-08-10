import { describe, expect, it } from 'vitest';

import { createCollectionJobQueueView } from '../../../apps/extension/popup/collectionJobQueueView.js';

function queueSummary(overrides = {}) {
  return {
    kind: 'success',
    summary: {
      claimed: 0,
      pending: 0,
      remaining: 0,
      retryWait: 0,
      waitingAuth: 0,
      ...overrides,
    },
  };
}

describe('extension collection-job queue presentation', () => {
  it('distinguishes manually queued price checks from snapshot uploads', () => {
    const view = createCollectionJobQueueView(queueSummary({ pending: 2, remaining: 2 }), {
      backgroundCollectionEnabled: false,
    });

    expect(view).toEqual({
      buttonDisabled: false,
      buttonLabel: 'Collect next price check',
      label: '2 waiting',
      message: '2 queued jobs. Manual mode collects one job per click.',
      shouldRefresh: true,
    });
  });

  it('shows collecting and remaining counts while preventing a second local claim', () => {
    const view = createCollectionJobQueueView(
      queueSummary({ claimed: 1, pending: 2, remaining: 3 }),
      { backgroundCollectionEnabled: true, localCollectionState: 'collecting' },
    );

    expect(view).toEqual({
      buttonDisabled: true,
      buttonLabel: 'Collection in progress',
      label: '3 remaining',
      message: '1 collecting job · 2 queued jobs.',
      shouldRefresh: true,
    });
  });

  it('disables collection when the backend queue is empty', () => {
    expect(createCollectionJobQueueView(queueSummary())).toEqual({
      buttonDisabled: true,
      buttonLabel: 'No queued price checks',
      label: 'Empty',
      message: 'No backend price-check jobs remain.',
      shouldRefresh: false,
    });
  });

  it('keeps a retry action available when the backend queue cannot be read', () => {
    expect(
      createCollectionJobQueueView({ error: 'Backend is unavailable', kind: 'temporary' }),
    ).toEqual({
      buttonDisabled: false,
      buttonLabel: 'Retry price-check queue',
      label: 'Unavailable',
      message: 'Backend is unavailable',
      shouldRefresh: false,
    });
  });
});
