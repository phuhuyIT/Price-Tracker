import pino from 'pino';

import { config } from '../config/index.js';

const LOGGER_REDACTION_PATHS = Object.freeze([
  'accessToken',
  'authorization',
  'botToken',
  'chatId',
  'cookie',
  'leaseToken',
  'messageText',
  'password',
  'sessionToken',
  'token',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.accessToken',
  'req.body.leaseToken',
  'req.body.password',
  'req.body.sessionToken',
  'req.body.token',
  'telegram.botToken',
  'telegram.chatId',
  '*.accessToken',
  '*.authorization',
  '*.botToken',
  '*.chatId',
  '*.cookie',
  '*.leaseToken',
  '*.messageText',
  '*.password',
  '*.sessionToken',
  '*.telegramBotToken',
  '*.telegramChatId',
  '*.token',
]);

/** Create a structured logger with the production sensitive-field policy. */
export function createLogger({
  destination,
  environment = config.environment,
  level = config.logLevel,
} = {}) {
  const options = {
    base: {
      environment,
      service: 'shopee-price-tracker',
    },
    level,
    redact: {
      censor: '[REDACTED]',
      paths: LOGGER_REDACTION_PATHS,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();
