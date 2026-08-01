import { createRepositories } from '../repositories/index.js';
import { createAuthenticationService } from './authenticationService.js';
import { createProductCollectionService } from './productCollectionService.js';
import { createProductManagementService } from './productManagementService.js';
import { createProductQueryService } from './productQueryService.js';
import { createTrackingService } from './trackingService.js';

/**
 * Compose repositories and core services over one shared database connection.
 *
 * @param {object} input
 * @param {object} input.applicationConfig
 * @param {((url: string) => Promise<unknown>) | null} [input.collectProduct]
 * @param {() => Date} [input.clock]
 * @param {import('better-sqlite3').Database} input.database
 * @param {object} [input.passwordHasher]
 */
export function createApplicationServices({
  applicationConfig,
  clock,
  collectProduct = null,
  database,
  passwordHasher,
}) {
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
  const productCollection = createProductCollectionService({
    collectProduct,
    productQueryService: productQuery,
    repositories,
    trackingService: tracking,
  });
  const productManagement = createProductManagementService({
    productQueryService: productQuery,
    repositories,
  });

  return Object.freeze({
    authentication,
    productCollection,
    productManagement,
    productQuery,
    repositories,
    tracking,
  });
}
