import { backendPermissionOrigin, normaliseBackendBaseUrl } from '../lib/extensionSettings.js';
import { RUNTIME_MESSAGES } from '../lib/runtimeMessages.js';

const elements = {
  accountEmail: document.querySelector('#account-email'),
  authDisabled: document.querySelector('#auth-disabled'),
  authEnabled: document.querySelector('#auth-enabled'),
  authStatus: document.querySelector('#auth-status'),
  automaticCapture: document.querySelector('#automatic-capture'),
  backendStatus: document.querySelector('#backend-status'),
  backendUrl: document.querySelector('#backend-url'),
  clearFailed: document.querySelector('#clear-failed'),
  contextKey: document.querySelector('#context-key'),
  debugMode: document.querySelector('#debug-mode'),
  email: document.querySelector('#email'),
  loginForm: document.querySelector('#login-form'),
  logout: document.querySelector('#logout'),
  password: document.querySelector('#password'),
  queueStatus: document.querySelector('#queue-status'),
  refreshAuth: document.querySelector('#refresh-auth'),
  regenerateContext: document.querySelector('#regenerate-context'),
  retryQueue: document.querySelector('#retry-queue'),
  settingsForm: document.querySelector('#settings-form'),
  settingsStatus: document.querySelector('#settings-status'),
  signedIn: document.querySelector('#signed-in'),
};

async function callServiceWorker(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.success) {
    const error = new Error(response?.error?.message ?? 'Extension service worker request failed');
    error.code = response?.error?.code;
    throw error;
  }

  return response.data;
}

function renderQueue(queue) {
  elements.queueStatus.textContent = `${queue.total} total · ${queue.pending} pending · ${queue.blocked} waiting for sign-in · ${queue.failed} failed`;
  elements.retryQueue.disabled = queue.total === 0;
  elements.clearFailed.disabled = queue.failed === 0;
}

function renderAuth(auth, backend) {
  elements.backendStatus.textContent =
    backend.status === 'connected'
      ? 'Backend connected.'
      : backend.status === 'unavailable'
        ? `Backend unavailable${backend.error ? `: ${backend.error}` : '.'}`
        : 'Backend authentication mode has not been checked.';
  elements.authDisabled.hidden = auth.mode !== 'disabled';
  elements.authEnabled.hidden = auth.mode !== 'enabled';
  elements.loginForm.hidden = auth.mode !== 'enabled' || auth.signedIn;
  elements.signedIn.hidden = !auth.signedIn;
  elements.accountEmail.textContent = auth.user?.email ?? '';
}

function render(state) {
  elements.backendUrl.value = state.settings.backendBaseUrl;
  elements.automaticCapture.checked = state.settings.automaticCapture;
  elements.debugMode.checked = state.settings.debugMode;
  elements.contextKey.textContent = state.settings.pricingContextKey;
  renderAuth(state.auth, state.backend);
  renderQueue(state.queue);
}

async function loadState() {
  render(await callServiceWorker({ type: RUNTIME_MESSAGES.GET_OPTIONS_STATE }));
}

async function refreshAuthentication() {
  elements.backendStatus.textContent = 'Checking backend authentication…';
  const result = await callServiceWorker({ type: RUNTIME_MESSAGES.PROBE_AUTH });
  renderAuth(result.auth, result.backend);
  await loadState();
}

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.settingsStatus.textContent = 'Saving…';

  try {
    const backendBaseUrl = normaliseBackendBaseUrl(elements.backendUrl.value);

    if (!backendBaseUrl) {
      throw new Error('Use an HTTPS URL or a local loopback HTTP origin without a path.');
    }

    const permissionOrigin = backendPermissionOrigin(backendBaseUrl);

    if (permissionOrigin) {
      const granted = await chrome.permissions.request({ origins: [permissionOrigin] });

      if (!granted) {
        throw new Error('Chrome did not grant access to that HTTPS backend origin.');
      }
    }

    await callServiceWorker({
      settings: {
        automaticCapture: elements.automaticCapture.checked,
        backendBaseUrl,
        debugMode: elements.debugMode.checked,
      },
      type: RUNTIME_MESSAGES.SAVE_SETTINGS,
    });
    elements.settingsStatus.textContent = 'Settings saved.';
    await loadState();
    await refreshAuthentication();
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
});

elements.regenerateContext.addEventListener('click', async () => {
  if (
    !window.confirm('Use a new pricing context for future captures? Existing history is unchanged.')
  ) {
    return;
  }

  try {
    const settings = await callServiceWorker({ type: RUNTIME_MESSAGES.REGENERATE_CONTEXT });
    elements.contextKey.textContent = settings.pricingContextKey;
  } catch (error) {
    elements.settingsStatus.textContent = error.message;
  }
});

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.authStatus.textContent = 'Signing in…';

  try {
    await callServiceWorker({
      credentials: { email: elements.email.value, password: elements.password.value },
      type: RUNTIME_MESSAGES.LOGIN,
    });
    elements.password.value = '';
    elements.authStatus.textContent = 'Signed in. Any authentication-blocked snapshots will retry.';
    await loadState();
  } catch (error) {
    elements.authStatus.textContent = error.message;
  }
});

elements.logout.addEventListener('click', async () => {
  elements.authStatus.textContent = 'Signing out…';

  try {
    await callServiceWorker({ type: RUNTIME_MESSAGES.LOGOUT });
    elements.authStatus.textContent = 'Signed out locally.';
    await loadState();
  } catch (error) {
    elements.authStatus.textContent = error.message;
  }
});

elements.refreshAuth.addEventListener('click', () => {
  void refreshAuthentication().catch((error) => {
    elements.backendStatus.textContent = error.message;
  });
});

elements.retryQueue.addEventListener('click', async () => {
  elements.queueStatus.textContent = 'Retrying queued snapshots…';

  try {
    renderQueue(await callServiceWorker({ type: RUNTIME_MESSAGES.RETRY_QUEUE }));
  } catch (error) {
    elements.queueStatus.textContent = error.message;
  }
});

elements.clearFailed.addEventListener('click', async () => {
  if (!window.confirm('Permanently remove failed snapshots from the local queue?')) {
    return;
  }

  try {
    renderQueue(await callServiceWorker({ type: RUNTIME_MESSAGES.CLEAR_FAILED_QUEUE }));
  } catch (error) {
    elements.queueStatus.textContent = error.message;
  }
});

void loadState()
  .then(() => refreshAuthentication())
  .catch((error) => {
    elements.backendStatus.textContent = error.message;
  });
