import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from '../../apps/server/src/db/connection.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { createRepositories } from '../../apps/server/src/repositories/index.js';

const validSnapshotPath = new URL(
  '../../packages/shared/examples/valid-product-snapshot.json',
  import.meta.url,
);

/**
 * Return an independent copy of the documented valid snapshot.
 */
export function loadValidSnapshot() {
  return JSON.parse(readFileSync(validSnapshotPath, 'utf8'));
}

/**
 * Create one isolated file-backed migrated database.
 */
export function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'shopee-price-db-'));
  const databasePath = join(directory, 'test.db');
  const database = openDatabase(databasePath);
  const migrationResult = runMigrations(database);
  const repositories = createRepositories(database);

  return {
    database,
    databasePath,
    directory,
    migrationResult,
    repositories,
    cleanup() {
      if (database.open) {
        database.close();
      }

      rmSync(directory, { force: true, recursive: true });
    },
  };
}

/**
 * Create a normal owner account with a test-only precomputed hash string.
 *
 * @param {ReturnType<typeof createRepositories>} repositories
 * @param {string} email
 */
export function createTestOwner(repositories, email = 'owner@example.com') {
  return repositories.users.create({
    createdAt: '2026-07-31T01:00:00.000Z',
    email,
    passwordHash: 'scrypt-v1:test-only-hash',
  });
}

/**
 * Persist one complete snapshot through the Phase 4 repository transaction.
 *
 * This helper intentionally performs orchestration only in tests. Phase 5 will
 * move validation and lifecycle policy into the tracking service.
 *
 * @param {object} input
 */
export function persistSnapshot({
  checkedAt = '2026-07-31T02:00:00.000Z',
  idempotencyKey = 'snapshot-test-key-0001',
  ownerUserId,
  repositories,
  snapshot = loadValidSnapshot(),
}) {
  return repositories.transaction((transactionRepositories) => {
    const product = transactionRepositories.products.upsert({
      alertThresholdPercent: 1,
      canonicalUrl: snapshot.canonicalUrl,
      currency: snapshot.currency,
      imageUrl: snapshot.imageUrl,
      itemId: snapshot.itemId,
      ownerUserId,
      platform: snapshot.platform,
      shopId: snapshot.shopId,
      title: snapshot.title,
      updatedAt: checkedAt,
    });
    const checkCreation = transactionRepositories.prices.createCheck({
      capturedAt: snapshot.capturedAt,
      checkedAt,
      coverageConfidence: snapshot.coverageConfidence,
      expectedVariantCount: snapshot.expectedVariantCount,
      idempotencyKey,
      lifecycleEligible: snapshot.lifecycleEligible,
      observedVariantCount: snapshot.observedVariantCount,
      ownerUserId,
      pricedVariantCount: snapshot.pricedVariantCount,
      pricingContext: snapshot.pricingContext,
      pricingContextKey: snapshot.pricingContextKey,
      productId: product.id,
      schemaVersion: snapshot.schemaVersion,
      source: snapshot.source,
      status: 'success',
      variantCoverage: snapshot.variantCoverage,
    });

    if (!checkCreation.created) {
      return {
        check: checkCreation.check,
        created: false,
        product,
        variants: transactionRepositories.variants.listByProduct({
          ownerUserId,
          productId: product.id,
        }),
      };
    }

    const variants = snapshot.variants.map((snapshotVariant) => {
      const { variant } = transactionRepositories.variants.upsertPresent({
        availability: snapshotVariant.availability,
        externalModelId: snapshotVariant.modelId,
        identityType: snapshotVariant.identityType,
        name: snapshotVariant.name,
        ownerUserId,
        productId: product.id,
        seenAt: checkedAt,
        stockQuantity: snapshotVariant.stockQuantity ?? null,
      });
      const observation = snapshotVariant.priceObservation;

      transactionRepositories.prices.insertCheckResult({
        availability: snapshotVariant.availability,
        checkId: checkCreation.check.id,
        createdAt: checkedAt,
        lifecycleEligible: false,
        ownerUserId,
        presence: 'present',
        priceStatus: observation.status,
        reasonCode: observation.status === 'not_observed' ? observation.reason : null,
        stockQuantity: snapshotVariant.stockQuantity ?? null,
        variantId: variant.id,
        variantLifecycle: variant.lifecycleStatus,
      });

      if (observation.status === 'observed') {
        transactionRepositories.prices.insertPriceLog({
          availability: snapshotVariant.availability,
          checkId: checkCreation.check.id,
          currency: observation.currency,
          ownerUserId,
          priceAmount: observation.priceAmount,
          priceDefinition: observation.priceDefinition,
          priceSource: observation.priceSource,
          priceType: observation.priceType,
          pricingContext: snapshot.pricingContext,
          pricingContextKey: snapshot.pricingContextKey,
          recordedAt: checkedAt,
          shippingIncluded: observation.shippingIncluded,
          variantId: variant.id,
          voucherStatus: observation.voucherStatus,
        });
      }

      return variant;
    });

    transactionRepositories.products.recordSuccessfulCheck({
      checkedAt,
      ownerUserId,
      productId: product.id,
    });

    return {
      check: checkCreation.check,
      created: true,
      product,
      variants,
    };
  });
}
