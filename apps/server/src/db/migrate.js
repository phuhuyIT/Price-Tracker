import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { config } from '../config/index.js';
import { logger } from '../logging/logger.js';

/**
 * Validate migration configuration for the Phase 2 foundation.
 *
 * The schema and migration engine are deliberately introduced in Phase 4.
 * Keeping this command successful now lets installation and deployment scripts
 * use the final command name without creating an empty SQLite database.
 *
 * @returns {{databaseDirectory: string, migrationCount: 0}}
 */
export function inspectMigrationPlan() {
  return {
    databaseDirectory: dirname(resolve(config.databasePath)),
    migrationCount: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  logger.info(inspectMigrationPlan(), 'No database migrations are registered in Phase 2');
}
