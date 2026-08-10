const LOCAL_BUSY_STATES = new Set(['collecting', 'queued', 'retry_wait']);

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

/** Convert backend price-check queue state into concise, accessible popup copy. */
export function createCollectionJobQueueView(
  queue,
  { backgroundCollectionEnabled = false, localCollectionState = 'idle' } = {},
) {
  if (queue === null) {
    return {
      buttonDisabled: true,
      buttonLabel: 'Checking price-check queue',
      label: 'Checking',
      message: 'Checking backend price-check jobs…',
      shouldRefresh: false,
    };
  }

  if (queue?.kind !== 'success') {
    return {
      buttonDisabled: false,
      buttonLabel: 'Retry price-check queue',
      label: 'Unavailable',
      message: queue?.error ?? 'The backend price-check queue is unavailable.',
      shouldRefresh: false,
    };
  }

  const { claimed, pending, remaining, retryWait, waitingAuth } = queue.summary;

  if (remaining === 0) {
    return {
      buttonDisabled: true,
      buttonLabel: 'No queued price checks',
      label: 'Empty',
      message: 'No backend price-check jobs remain.',
      shouldRefresh: false,
    };
  }

  const parts = [];

  if (claimed > 0) {
    parts.push(plural(claimed, 'collecting job'));
  }

  if (pending > 0) {
    parts.push(plural(pending, 'queued job'));
  }

  if (retryWait > 0) {
    parts.push(plural(retryWait, 'job waiting to retry', 'jobs waiting to retry'));
  }

  if (waitingAuth > 0) {
    parts.push(plural(waitingAuth, 'job waiting for sign-in', 'jobs waiting for sign-in'));
  }

  const manualHint =
    !backgroundCollectionEnabled && pending + waitingAuth > 0
      ? ' Manual mode collects one job per click.'
      : '';
  const localBusy = LOCAL_BUSY_STATES.has(localCollectionState);
  const claimable = pending + waitingAuth;
  let buttonDisabled = false;
  let buttonLabel = 'Collect next price check';

  if (localBusy) {
    buttonDisabled = true;
    buttonLabel = 'Collection in progress';
  } else if (claimable === 0 && claimed > 0) {
    buttonDisabled = true;
    buttonLabel = 'Price check collecting';
  } else if (claimable === 0 && retryWait > 0) {
    buttonDisabled = true;
    buttonLabel = 'Waiting to retry price check';
  }

  return {
    buttonDisabled,
    buttonLabel,
    label:
      claimed === remaining
        ? `${claimed} collecting`
        : claimed === 0
          ? `${remaining} waiting`
          : `${remaining} remaining`,
    message: `${parts.join(' · ')}.${manualHint}`,
    shouldRefresh: true,
  };
}
