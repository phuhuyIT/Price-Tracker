import { createApp } from './src/app.js';
import { config } from './src/config/index.js';
import { closeDatabase, getDatabase } from './src/db/connection.js';
import { runMigrations } from './src/db/migrate.js';
import { logger } from './src/logging/logger.js';
import { createPriceScheduler } from './src/jobs/priceScheduler.js';
import { createApplicationServices } from './src/services/applicationServices.js';

const database = getDatabase();
const migrationResult = runMigrations(database);
const services = createApplicationServices({ applicationConfig: config, database });
const app = createApp({ services });
const scheduler = createPriceScheduler({
  collectionJobService: services.collectionJobs,
  config: { ...config.collection, ...config.cron },
  logger,
  productCollectionService: services.productCollection,
  repositories: services.repositories,
});
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
  scheduler.start();
});

let isShuttingDown = false;

/**
 * Stop accepting connections and allow active requests to finish.
 *
 * @param {NodeJS.Signals} signal
 */
async function shutDown(signal) {
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

  try {
    await scheduler.stop();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    logger.info({ signal }, 'Server stopped');
  } catch (error) {
    logger.error({ err: error, signal }, 'Server shutdown failed');
    process.exitCode = 1;
  } finally {
    clearTimeout(forceExitTimer);
    closeDatabase();
  }
}

process.on('SIGINT', () => void shutDown('SIGINT'));
process.on('SIGTERM', () => void shutDown('SIGTERM'));
