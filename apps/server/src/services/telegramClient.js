import { ERROR_CODES } from '@shopee-price-tracker/shared';

import { AppError } from '../errors/AppError.js';

const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';

function sleepFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTemporaryStatus(status) {
  return [408, 425, 429].includes(status) || status >= 500;
}

function telegramError({ attempts, message, retryAfterMs = null, retryable, status = null }) {
  return new AppError({
    code: ERROR_CODES.TELEGRAM_ERROR,
    details: { attempts, retryAfterMs, retryable, status },
    message,
    statusCode: 502,
  });
}

function retryDelay({ attempt, config, retryAfterMs }) {
  const requestedDelay = Number.isSafeInteger(retryAfterMs)
    ? retryAfterMs
    : config.retryBaseDelayMs * 2 ** Math.max(attempt - 1, 0);
  return Math.min(requestedDelay, config.retryMaxDelayMs);
}

/** Create a bounded Telegram Bot API client without exposing its token to logs. */
export function createTelegramClient({ config, fetchImplementation = fetch, sleep = sleepFor }) {
  async function requestOnce(method, parameters, attempt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response;

    try {
      response = await fetchImplementation(
        `${TELEGRAM_API_ORIGIN}/bot${config.botToken}/${method}`,
        {
          body: JSON.stringify(parameters),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        },
      );
    } catch {
      throw telegramError({
        attempts: attempt,
        message: controller.signal.aborted
          ? 'Telegram request timed out'
          : 'Telegram is temporarily unavailable',
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }

    let body = null;

    try {
      body = await response.json();
    } catch {
      // A malformed response is classified from its HTTP status below.
    }

    if (response.ok && body?.ok === true) {
      return body.result;
    }

    const status = Number.isSafeInteger(body?.error_code) ? body.error_code : response.status;
    const retryable = isTemporaryStatus(status);
    const retryAfterSeconds = Number(body?.parameters?.retry_after);
    const retryAfterMs =
      Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds >= 0
        ? retryAfterSeconds * 1_000
        : null;

    throw telegramError({
      attempts: attempt,
      message: retryable
        ? 'Telegram temporarily rejected the request'
        : 'Telegram permanently rejected the request',
      retryAfterMs,
      retryable,
      status,
    });
  }

  async function request(method, parameters = {}) {
    if (!config.enabled) {
      return { disabled: true };
    }

    let lastError;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      try {
        return await requestOnce(method, parameters, attempt);
      } catch (error) {
        lastError = error;

        if (!error?.details?.retryable || attempt >= config.maxAttempts) {
          throw error;
        }

        await sleep(
          retryDelay({
            attempt,
            config,
            retryAfterMs: error.details.retryAfterMs,
          }),
        );
      }
    }

    throw lastError;
  }

  return Object.freeze({
    enabled: config.enabled,

    /** Verify both the bot credential and configured destination without sending a message. */
    async testConnection() {
      if (!config.enabled) {
        return { enabled: false };
      }

      const bot = await request('getMe');
      const chat = await request('getChat', { chat_id: config.chatId });

      return {
        botUsername: typeof bot?.username === 'string' ? bot.username : null,
        chatType: typeof chat?.type === 'string' ? chat.type : null,
        enabled: true,
      };
    },

    /** Send one HTML-formatted price-drop message. */
    async sendMessage(text) {
      const message = await request('sendMessage', {
        chat_id: config.chatId,
        link_preview_options: { is_disabled: true },
        parse_mode: 'HTML',
        text,
      });

      return {
        messageId: Number.isSafeInteger(message?.message_id) ? message.message_id : null,
      };
    },
  });
}
