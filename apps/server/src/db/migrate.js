import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { closeDatabase, getDatabase } from './connection.js';
import { DatabaseError } from '../errors/DatabaseError.js';
import { logger } from '../logging/logger.js';

const MIGRATION_FILE_PATTERN = /^(?<version>\d{3})-(?<name>[a-z0-9]+(?:-[a-z0-9]+)*)\.sql$/u;
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function checksum(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

/**
 * Discover, validate, and read ordered SQL migration files.
 *
 * @param {string} [directory]
 * @returns {Array<{checksum: string, filename: string, name: string, sql: string, version: number}>}
 */
export function loadMigrations(directory = migrationsDirectory) {
  const migrations = readdirSync(directory)
    .filter((filename) => filename.endsWith('.sql'))
    .map((filename) => {
      const match = MIGRATION_FILE_PATTERN.exec(filename);

      if (!match) {
        throw new DatabaseError(`Invalid migration filename: ${filename}`);
      }

      const sql = readFileSync(join(directory, filename), 'utf8');

      return {
        checksum: checksum(sql),
        filename,
        name: match.groups.name,
        sql,
        version: Number(match.groups.version),
      };
    })
    .sort((left, right) => left.version - right.version);

  const versions = new Set();
  const names = new Set();

  for (const migration of migrations) {
    if (versions.has(migration.version) || names.has(migration.name)) {
      throw new DatabaseError(`Duplicate migration detected: ${migration.filename}`);
    }

    versions.add(migration.version);
    names.add(migration.name);
  }

  return migrations;
}

function createMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

/**
 * Apply pending migrations and verify already-applied checksums.
 *
 * @param {import('better-sqlite3').Database} database
 * @param {{directory?: string, now?: () => string}} [options]
 * @returns {{applied: string[], currentVersion: number, skipped: string[]}}
 */
export function runMigrations(
  database,
  { directory = migrationsDirectory, now = () => new Date().toISOString() } = {},
) {
  try {
    createMigrationTable(database);

    const migrations = loadMigrations(directory);
    const appliedRows = database
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all();
    const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));
    const availableVersions = new Set(migrations.map((migration) => migration.version));

    for (const applied of appliedRows) {
      if (!availableVersions.has(applied.version)) {
        throw new DatabaseError(
          `Applied migration ${applied.version} (${applied.name}) is missing from the repository`,
        );
      }
    }

    const applied = [];
    const skipped = [];
    const insertMigration = database.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (@version, @name, @checksum, @appliedAt)
    `);

    for (const migration of migrations) {
      const existing = appliedByVersion.get(migration.version);

      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
          throw new DatabaseError(
            `Applied migration ${migration.version} no longer matches ${migration.filename}`,
          );
        }

        skipped.push(migration.filename);
        continue;
      }

      database.transaction(() => {
        database.exec(migration.sql);
        insertMigration.run({
          appliedAt: now(),
          checksum: migration.checksum,
          name: migration.name,
          version: migration.version,
        });
        database.pragma(`user_version = ${migration.version}`);
      })();

      applied.push(migration.filename);
    }

    return {
      applied,
      currentVersion: migrations.at(-1)?.version ?? 0,
      skipped,
    };
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError('Unable to migrate the SQLite database', { cause: error });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const database = getDatabase();

  try {
    const result = runMigrations(database);
    logger.info(
      {
        appliedMigrations: result.applied,
        currentVersion: result.currentVersion,
        databasePath: resolve(database.name),
        skippedMigrationCount: result.skipped.length,
      },
      'Database migrations complete',
    );
  } finally {
    closeDatabase();
  }
}

export const migrationDirectoryName = basename(migrationsDirectory);
