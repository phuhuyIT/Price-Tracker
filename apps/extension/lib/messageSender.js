/** Determine whether a runtime message came from this extension's own UI page. */
export function isTrustedExtensionPageSender(sender, runtimeId) {
  if (sender?.id !== runtimeId || typeof sender?.url !== 'string') {
    return false;
  }

  try {
    const senderUrl = new URL(sender.url);
    return senderUrl.protocol === 'chrome-extension:' && senderUrl.hostname === runtimeId;
  } catch {
    return false;
  }
}
