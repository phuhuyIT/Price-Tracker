const INSTALL_STATUS_KEY = 'foundationStatus';

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    [INSTALL_STATUS_KEY]: {
      installedAt: new Date().toISOString(),
      protocolVersion: 1,
      status: 'ready',
    },
  });
});
