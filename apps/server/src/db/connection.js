import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { config } from '../config/index.js';
import { DatabaseError } from '../errors/DatabaseError.js';

let sharedDatabase;

function prepareDatabaseDirectory(databasePath) {
  if (databasePath === ':memory:' || databasePath.startsWith('file:')) {
    return;
  }

  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}

/**
 * Open and configure a SQLite connection.
 *
 * @param {string} databasePath
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(databasePath) {
  let database;

  try {
    prepareDatabaseDirectory(databasePath);

    database = new Database(databasePath);
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');

    if (databasePath !== ':memory:') {
      database.pragma('journal_mode = WAL');
    }

    return database;
  } catch (error) {
    if (database?.open) {
      database.close();
    }

    throw new DatabaseError('Unable to open the SQLite database', {
      cause: error,
      details: { databasePath: resolve(databasePath) },
    });
  }
}

/**
 * Return the process-wide application database connection.
 *
 * @returns {import('better-sqlite3').Database}
 */
export function getDatabase() {
  if (!sharedDatabase?.open) {
    sharedDatabase = openDatabase(config.databasePath);
  }

  return sharedDatabase;
}

/**
 * Close the process-wide application database connection.
 */
export function closeDatabase() {
  if (sharedDatabase?.open) {
    sharedDatabase.close();
  }

  sharedDatabase = undefined;
}
