import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../apps/server/src/logging/logger.js';

describe('structured logger redaction', () => {
  it('redacts application, Telegram, request, and nested credentials', () => {
    const chunks = [];
    const destination = {
      write(chunk) {
        chunks.push(String(chunk));
      },
    };
    const logger = createLogger({ destination, environment: 'test', level: 'info' });
    const secrets = {
      authorization: 'Bearer application-secret',
      botToken: 'telegram-bot-secret-that-must-not-appear',
      chatId: '-1001234567890',
      cookie: 'price_tracker_session=cookie-secret',
      leaseToken: 'collection-lease-secret',
      messageText: 'private Telegram message body',
      password: 'private password',
      sessionToken: 'session-secret',
      token: 'generic-token-secret',
    };

    logger.info(
      {
        ...secrets,
        nested: {
          authorization: secrets.authorization,
          botToken: secrets.botToken,
          chatId: secrets.chatId,
          cookie: secrets.cookie,
          leaseToken: secrets.leaseToken,
          messageText: secrets.messageText,
          password: secrets.password,
          sessionToken: secrets.sessionToken,
          telegramBotToken: secrets.botToken,
          telegramChatId: secrets.chatId,
          token: secrets.token,
        },
        req: {
          body: {
            leaseToken: secrets.leaseToken,
            password: secrets.password,
            sessionToken: secrets.sessionToken,
            token: secrets.token,
          },
          headers: {
            authorization: secrets.authorization,
            cookie: secrets.cookie,
          },
        },
        telegram: {
          botToken: secrets.botToken,
          chatId: secrets.chatId,
        },
      },
      'Sensitive-field audit',
    );

    const output = chunks.join('');
    expect(output).toContain('[REDACTED]');

    for (const secret of Object.values(secrets)) {
      expect(output).not.toContain(secret);
    }
  });
});
