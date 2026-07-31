import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../apps/server/src/db/connection.js';
import { loadMigrations, runMigrations } from '../../apps/server/src/db/migrate.js';
import { DatabaseError } from '../../apps/server/src/errors/DatabaseError.js';
import { createTestDatabase } from './databaseTestUtils.js';

const harnesses = [];

afterEach(() => {
  while (harnesses.length > 0) {
    harnesses.pop().cleanup();
  }
});

describe('database migrations', () => {
  it('creates the Phase 4 schema with foreign keys, WAL, and a stored version', () => {
    const harness = createTestDatabase();
    harnesses.push(harness);

    expect(harness.database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(harness.database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(harness.database.pragma('user_version', { simple: true })).toBe(1);
    expect(harness.migrationResult.applied).toEqual(['001-initial.sql']);

    const tables = harness.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

    expect(tables).toEqual([
      'notification_events',
      'price_checks',
      'price_logs',
      'product_variants',
      'products',
      'schema_migrations',
      'user_sessions',
      'users',
      'variant_check_results',
    ]);
  });

  it('skips an already applied migration without applying it twice', () => {
    const harness = createTestDatabase();
    harnesses.push(harness);

    const secondRun = runMigrations(harness.database);

    expect(secondRun.applied).toEqual([]);
    expect(secondRun.skipped).toEqual(['001-initial.sql']);
    expect(
      harness.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count,
    ).toBe(1);
  });

  it('rejects duplicate migration versions before changing the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shopee-migrations-'));
    const database = openDatabase(':memory:');
    const originalMigration = loadMigrations()[0];

    writeFileSync(join(directory, '001-first.sql'), originalMigration.sql);
    writeFileSync(join(directory, '001-second.sql'), 'SELECT 1;');

    expect(() => runMigrations(database, { directory })).toThrow(DatabaseError);
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(0);

    database.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it('rejects changes to an already applied migration checksum', () => {
    const harness = createTestDatabase();
    harnesses.push(harness);
    const directory = mkdtempSync(join(tmpdir(), 'shopee-migrations-'));
    const originalMigration = loadMigrations()[0];

    writeFileSync(
      join(directory, originalMigration.filename),
      `${readFileSync(new URL('../../apps/server/src/db/migrations/001-initial.sql', import.meta.url), 'utf8')}\nSELECT 1;\n`,
    );

    expect(() => runMigrations(harness.database, { directory })).toThrow(/no longer matches/u);

    rmSync(directory, { force: true, recursive: true });
  });
});
