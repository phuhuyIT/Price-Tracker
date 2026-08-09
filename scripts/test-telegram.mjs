import { config } from '../apps/server/src/config/index.js';
import { logger } from '../apps/server/src/logging/logger.js';
import { createTelegramClient } from '../apps/server/src/services/telegramClient.js';

const telegram = createTelegramClient({ config: config.telegram });

try {
  const result = await telegram.testConnection();

  if (!result.enabled) {
    logger.warn('Telegram notifications are disabled; configure both token and chat ID');
    process.exitCode = 1;
  } else {
    logger.info(
      { botUsername: result.botUsername, chatType: result.chatType },
      'Telegram bot and destination are reachable',
    );
  }
} catch (error) {
  logger.error({ errorCode: error?.code ?? 'TELEGRAM_ERROR' }, 'Telegram connection test failed');
  process.exitCode = 1;
}
