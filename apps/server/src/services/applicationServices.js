import { createRepositories } from '../repositories/index.js';
import { createAuthenticationService } from './authenticationService.js';
import { createCollectionJobService } from './collectionJobService.js';
import { createProductCollectionService } from './productCollectionService.js';
import { createProductManagementService } from './productManagementService.js';
import { createProductQueryService } from './productQueryService.js';
import { createTrackingService } from './trackingService.js';

/**
 * Compose repositories and core services over one shared database connection.
 *
 * @param {object} input
 * @param {object} input.applicationConfig
 * @param {() => Date} [input.clock]
 * @param {import('better-sqlite3').Database} input.database
 * @param {object} [input.passwordHasher]
 */
export function createApplicationServices({ applicationConfig, clock, database, passwordHasher }) {
  const repositories = createRepositories(database);
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
    productCollection,
    productManagement,
    productQuery,
    repositories,
    tracking,
  });
}
