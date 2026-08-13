import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createSchemaBackup,
  loadReleaseMetadata,
  prepareRelease,
} from '../../scripts/prepare-release.mjs';

const repositoryRoot = process.cwd();
const releaseDocumentationFiles = [
  'README.md',
  'docs/setup.md',
  'docs/developer-guide.md',
  'docs/troubleshooting.md',
  'docs/release.md',
];
const expectedEnvironmentKeys = [
  'NODE_ENV',
  'HOST',
  'PORT',
  'DATABASE_PATH',
  'AUTH_ENABLED',
  'AUTH_ALLOW_REGISTRATION',
  'AUTH_SESSION_TTL_HOURS',
  'COLLECTION_JOB_LEASE_MS',
  'COLLECTION_MAX_ATTEMPTS',
  'COLLECTION_RETRY_BASE_DELAY_MS',
  'COLLECTION_RETRY_MAX_DELAY_MS',
  'COLLECTION_DISPATCH_DELAY_MIN_MS',
  'COLLECTION_DISPATCH_DELAY_MAX_MS',
  'CRON_ENABLED',
  'CRON_SCHEDULE',
  'SHOPEE_HEADLESS',
  'SHOPEE_PRICE_SCALE',
  'SCRAPE_TIMEOUT_MS',
  'SCRAPE_DELAY_MIN_MS',
  'SCRAPE_DELAY_MAX_MS',
  'SCRAPE_MAX_RETRIES',
  'PRICE_DROP_THRESHOLD_PERCENT',
  'VARIANT_MISSING_THRESHOLD',
  'MAX_VARIANT_MISSING_RATIO',
  'VARIANT_MASS_MISSING_CONFIRMATIONS',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'TELEGRAM_REQUEST_TIMEOUT_MS',
  'TELEGRAM_MAX_ATTEMPTS',
  'TELEGRAM_RETRY_BASE_DELAY_MS',
  'TELEGRAM_RETRY_MAX_DELAY_MS',
  'EXTENSION_ALLOWED_ORIGIN',
  'API_RATE_LIMIT_WINDOW_MS',
  'API_RATE_LIMIT_MAX',
  'LOG_LEVEL',
];

describe('release preparation', () => {
  it('keeps release versions aligned and exports the migrated empty schema', async () => {
    const metadata = await loadReleaseMetadata(repositoryRoot);
    const schema = await createSchemaBackup(repositoryRoot);

    expect(metadata).toMatchObject({
      nodeEngine: '>=20',
      version: '1.0.0',
    });
    expect(schema.schemaVersion).toBe(4);
    expect(schema.migrations.map((migration) => migration.filename)).toEqual([
      '001-initial.sql',
      '002-collection-jobs.sql',
      '003-scheduled-collection.sql',
      '004-variant-stock.sql',
    ]);
    expect(schema.sql).toContain('CREATE TABLE products');
    expect(schema.sql).toContain('CREATE TABLE "collection_jobs"');
    expect(schema.sql).toContain('current_stock_quantity INTEGER');
    expect(schema.sql).not.toContain('INSERT INTO products');
  });

  it('creates a versioned unpacked-extension and schema release bundle', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shopee-price-release-'));
    const extensionBuildDirectory = join(temporaryRoot, 'extension');

    try {
      await mkdir(extensionBuildDirectory, { recursive: true });
      await writeFile(
        join(extensionBuildDirectory, 'manifest.json'),
        `${JSON.stringify({
          manifest_version: 3,
          minimum_chrome_version: '116',
          version: '1.0.0',
        })}\n`,
        'utf8',
      );

      const result = await prepareRelease({
        extensionBuildDirectory,
        generatedAt: '2026-08-12T00:00:00.000Z',
        outputBase: join(temporaryRoot, 'releases'),
        repositoryRoot,
      });
      const manifest = JSON.parse(
        await readFile(join(result.releaseDirectory, 'RELEASE-MANIFEST.json'), 'utf8'),
      );
      const checksums = await readFile(join(result.releaseDirectory, 'CHECKSUMS.sha256'), 'utf8');

      expect(result).toMatchObject({ schemaVersion: 4, version: '1.0.0' });
      expect(manifest).toMatchObject({
        database: { schemaVersion: 4 },
        extension: { version: '1.0.0' },
        releaseVersion: '1.0.0',
      });
      expect(
        await readFile(join(result.releaseDirectory, 'extension', 'manifest.json'), 'utf8'),
      ).toContain('1.0.0');
      expect(
        await readFile(join(result.releaseDirectory, 'database-schema', 'schema-v4.sql'), 'utf8'),
      ).toContain('PRAGMA user_version = 4');
      expect(checksums).toContain('extension/manifest.json');
      expect(checksums).toContain('database-schema/migrations/004-variant-stock.sql');
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it('keeps the environment template complete and release documentation links valid', async () => {
    const environmentTemplate = await readFile(join(repositoryRoot, '.env.example'), 'utf8');
    const environmentKeys = environmentTemplate
      .split(/\r?\n/u)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => line.slice(0, line.indexOf('=')));

    expect(environmentKeys).toEqual(expectedEnvironmentKeys);

    for (const relativeDocumentPath of releaseDocumentationFiles) {
      const documentPath = join(repositoryRoot, relativeDocumentPath);
      const source = await readFile(documentPath, 'utf8');
      const localTargets = [...source.matchAll(/\[[^\]]*\]\((?!https?:|#)([^)]+)\)/gu)].map(
        (match) => match[1].split('#')[0],
      );

      for (const localTarget of localTargets) {
        await expect(
          access(resolve(dirname(documentPath), localTarget)),
          `${relativeDocumentPath} links to missing ${localTarget}`,
        ).resolves.toBeUndefined();
      }
    }
  });
});
