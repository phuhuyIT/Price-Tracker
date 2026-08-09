import { createRepositories } from '../repositories/index.js';
import { createAuthenticationService } from './authenticationService.js';
import { createCollectionJobService } from './collectionJobService.js';
import { createNotificationService } from './notificationService.js';
import { createProductCollectionService } from './productCollectionService.js';
import { createProductManagementService } from './productManagementService.js';
import { createProductQueryService } from './productQueryService.js';
import { createTrackingService } from './trackingService.js';
import { createTelegramClient } from './telegramClient.js';

/**
 * Compose repositories and core services over one shared database connection.
 *
 * @param {object} input
 * @param {object} input.applicationConfig
 * @param {object} [input.applicationLogger]
 * @param {() => Date} [input.clock]
 * @param {import('better-sqlite3').Database} input.database
 * @param {object} [input.passwordHasher]
 * @param {object} [input.telegramClient]
 */
export function createApplicationServices({
  applicationConfig,
  applicationLogger,
  clock,
  database,
  passwordHasher,
  telegramClient,
}) {
  const repositories = createRepositories(database);
  const resolvedTelegramClient =
    telegramClient ?? createTelegramClient({ config: applicationConfig.telegram });
  const notifications = createNotificationService({
    clock,
    notificationLogger: applicationLogger,
    repositories,
    telegramClient: resolvedTelegramClient,
  });
  const authentication = createAuthenticationService({
    authConfig: applicationConfig.auth,
    clock,
    passwordHasher,
    repositories,
  });
  const productQuery = createProductQueryService({ repositories });
  const tracking = createTrackingService({
    clock,
    lifecycleConfig: applicationConfig.lifecycle,
    priceDropThresholdPercent: applicationConfig.priceDropThresholdPercent,
    repositories,
  });
  const collectionJobs = createCollectionJobService({
    clock,
    leaseMs: applicationConfig.collection.leaseMs,
    maxAttempts: applicationConfig.collection.maxAttempts,
    notificationService: notifications,
    repositories,
    retryBaseDelayMs: applicationConfig.collection.retryBaseDelayMs,
    retryMaxDelayMs: applicationConfig.collection.retryMaxDelayMs,
    trackingService: tracking,
  });
  const productCollection = createProductCollectionService({
    collectionJobService: collectionJobs,
    productQueryService: productQuery,
    repositories,
  });
  const productManagement = createProductManagementService({
    productQueryService: productQuery,
    repositories,
  });

  return Object.freeze({
    authentication,
    collectionJobs,
    notifications,
    productCollection,
    productManagement,
    productQuery,
    repositories,
    telegram: resolvedTelegramClient,
    tracking,
  });
}
