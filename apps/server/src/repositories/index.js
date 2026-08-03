import { createCollectionJobRepository } from './collectionJobRepository.js';
import { createNotificationRepository } from './notificationRepository.js';
import { createPriceRepository } from './priceRepository.js';
import { createProductRepository } from './productRepository.js';
import { createSessionRepository } from './sessionRepository.js';
import { createUserRepository } from './userRepository.js';
import { createVariantRepository } from './variantRepository.js';

/**
 * Build repositories over one shared better-sqlite3 connection.
 *
 * The transaction callback must remain synchronous. Asynchronous network work,
 * including Telegram delivery, belongs outside this transaction.
 *
 * @param {import('better-sqlite3').Database} database
 */
export function createRepositories(database) {
  const repositories = Object.freeze({
    collectionJobs: createCollectionJobRepository(database),
    notifications: createNotificationRepository(database),
    prices: createPriceRepository(database),
    products: createProductRepository(database),
    sessions: createSessionRepository(database),
    users: createUserRepository(database),
    variants: createVariantRepository(database),
  });

  return Object.freeze({
    ...repositories,

    /**
     * Run one atomic persistence operation.
     *
     * @template T
     * @param {(repositories: typeof repositories) => T} work
     * @returns {T}
     */
    transaction(work) {
      if (typeof work !== 'function') {
        throw new TypeError('Transaction work must be a function');
      }

      return database
        .transaction(() => {
          const result = work(repositories);

          if (result && typeof result.then === 'function') {
            throw new TypeError('Transaction work must be synchronous');
          }

          return result;
        })
        .immediate();
    },
  });
}

export { createNotificationRepository } from './notificationRepository.js';
export { createCollectionJobRepository } from './collectionJobRepository.js';
export { createPriceRepository } from './priceRepository.js';
export { createProductRepository } from './productRepository.js';
export { createSessionRepository } from './sessionRepository.js';
export { createUserRepository, RESERVED_LOCAL_USER_EMAIL } from './userRepository.js';
export { createVariantRepository } from './variantRepository.js';
