import { describe, expect, it, vi } from 'vitest';

import { createTelegramClient } from '../../../apps/server/src/services/telegramClient.js';

const enabledConfig = Object.freeze({
  botToken: '123456:test-token',
  chatId: '-100123456',
  enabled: true,
  maxAttempts: 2,
  requestTimeoutMs: 1_000,
  retryBaseDelayMs: 100,
  retryMaxDelayMs: 2_000,
});

function telegramResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('Telegram Bot API client', () => {
  it('stays disabled without making a network request', async () => {
    const fetchImplementation = vi.fn();
    const client = createTelegramClient({
      config: { ...enabledConfig, botToken: undefined, chatId: undefined, enabled: false },
      fetchImplementation,
    });

    await expect(client.testConnection()).resolves.toEqual({ enabled: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('sends an HTML message with the configured destination and no link preview', async () => {
    const fetchImplementation = vi.fn(async () =>
      telegramResponse({ ok: true, result: { message_id: 77 } }),
    );
    const client = createTelegramClient({ config: enabledConfig, fetchImplementation });

    await expect(client.sendMessage('<b>Alert</b>')).resolves.toEqual({ messageId: 77 });
    const [url, options] = fetchImplementation.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123456:test-token/sendMessage');
    expect(JSON.parse(options.body)).toEqual({
      chat_id: '-100123456',
      link_preview_options: { is_disabled: true },
      parse_mode: 'HTML',
      text: '<b>Alert</b>',
    });
  });

  it('retries a temporary Telegram error and respects retry_after', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        telegramResponse(
          {
            description: 'Too Many Requests',
            error_code: 429,
            ok: false,
            parameters: { retry_after: 1 },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(telegramResponse({ ok: true, result: { message_id: 88 } }));
    const sleep = vi.fn(async () => {});
    const client = createTelegramClient({ config: enabledConfig, fetchImplementation, sleep });

    await expect(client.sendMessage('Alert')).resolves.toEqual({ messageId: 88 });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('does not retry a permanent Telegram error', async () => {
    const fetchImplementation = vi.fn(async () =>
      telegramResponse({ description: 'Bad Request', error_code: 400, ok: false }, 400),
    );
    const sleep = vi.fn();
    const client = createTelegramClient({ config: enabledConfig, fetchImplementation, sleep });

    await expect(client.sendMessage('Alert')).rejects.toMatchObject({
      code: 'TELEGRAM_ERROR',
      details: { attempts: 1, retryable: false, status: 400 },
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('tests the bot credential and destination without sending a message', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        telegramResponse({ ok: true, result: { username: 'price_tracker_bot' } }),
      )
      .mockResolvedValueOnce(
        telegramResponse({ ok: true, result: { id: -100123456, type: 'supergroup' } }),
      );
    const client = createTelegramClient({ config: enabledConfig, fetchImplementation });

    await expect(client.testConnection()).resolves.toEqual({
      botUsername: 'price_tracker_bot',
      chatType: 'supergroup',
      enabled: true,
    });
    expect(fetchImplementation.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual([
      'getMe',
      'getChat',
    ]);
  });
});
