import { createApp } from './src/app.js';
import { config } from './src/config/index.js';
import { closeDatabase, getDatabase } from './src/db/connection.js';
import { runMigrations } from './src/db/migrate.js';
import { logger } from './src/logging/logger.js';

const database = getDatabase();
const migrationResult = runMigrations(database);
const app = createApp();
const server = app.listen(config.port, config.host, () => {
  logger.info(
    {
      databaseVersion: migrationResult.currentVersion,
      authEnabled: config.auth.enabled,
      host: config.host,
      port: config.port,
    },
    'Server started',
  );
});

let isShuttingDown = false;

/**
 * Stop accepting connections and allow active requests to finish.
 *
 * @param {NodeJS.Signals} signal
 */
function shutDown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Server shutdown requested');

  const forceExitTimer = setTimeout(() => {
    logger.error({ signal }, 'Server shutdown timed out');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  server.close((error) => {
    clearTimeout(forceExitTimer);
    closeDatabase();

    if (error) {
      logger.error({ err: error, signal }, 'Server shutdown failed');
      process.exitCode = 1;
    } else {
      logger.info({ signal }, 'Server stopped');
    }
  });
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
