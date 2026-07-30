import pino from 'pino';

import { config } from '../config/index.js';

export const logger = pino({
  base: {
    environment: config.environment,
    service: 'shopee-price-tracker',
  },
  level: config.logLevel,
  redact: {
    censor: '[REDACTED]',
    paths: [
      'authorization',
      'botToken',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.sessionToken',
      'sessionToken',
      'telegram.botToken',
      '*.authorization',
      '*.cookie',
      '*.sessionToken',
      '*.telegramBotToken',
    ],
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
