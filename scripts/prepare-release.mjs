import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '..');
const migrationFilenamePattern = /^(?<version>\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/u;
const releaseDocumentation = [
  'README.md',
  '.env.example',
  'docs/setup.md',
  'docs/developer-guide.md',
  'docs/troubleshooting.md',
  'docs/release.md',
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function sha256File(filePath) {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function listFiles(directory) {
  const entries = await readdir(directory);
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry);
    const entryStats = await stat(entryPath);

    if (entryStats.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

function assertSafeReleaseDirectory(outputBase, releaseDirectory) {
  const relativeTarget = relative(resolve(outputBase), resolve(releaseDirectory));

  if (
    relativeTarget === '' ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..\\`) ||
    relativeTarget.startsWith('../') ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(`Unsafe release output directory: ${releaseDirectory}`);
  }
}

/**
 * Read and validate the versions that form one MVP release.
 *
 * @param {string} [repositoryRoot]
 */
export async function loadReleaseMetadata(repositoryRoot = defaultRepositoryRoot) {
  const [rootPackage, serverPackage, sharedPackage, extensionManifest] = await Promise.all([
    readJson(join(repositoryRoot, 'package.json')),
    readJson(join(repositoryRoot, 'apps', 'server', 'package.json')),
    readJson(join(repositoryRoot, 'packages', 'shared', 'package.json')),
    readJson(join(repositoryRoot, 'apps', 'extension', 'manifest.json')),
  ]);
  const versions = new Map([
    ['application', rootPackage.version],
    ['server', serverPackage.version],
    ['shared', sharedPackage.version],
    ['extension', extensionManifest.version],
  ]);
  const uniqueVersions = new Set(versions.values());

  if (uniqueVersions.size !== 1) {
    throw new Error(
      `Release versions must match: ${[...versions].map(([name, version]) => `${name}=${version}`).join(', ')}`,
    );
  }

  const version = rootPackage.version;

  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Release version must use numeric SemVer: ${version}`);
  }

  return {
    extensionManifest,
    nodeEngine: rootPackage.engines?.node ?? null,
    version,
  };
}

async function loadMigrationSources(repositoryRoot) {
  const migrationDirectory = join(repositoryRoot, 'apps', 'server', 'src', 'db', 'migrations');
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => filename.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  const migrations = [];

  for (const filename of filenames) {
    const match = migrationFilenamePattern.exec(filename);

    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const sql = await readFile(join(migrationDirectory, filename), 'utf8');
    migrations.push({
      filename,
      sha256: createHash('sha256').update(sql).digest('hex'),
      sql,
      version: Number(match.groups.version),
    });
  }

  if (migrations.length === 0) {
    throw new Error('No database migrations were found');
  }

  return { migrationDirectory, migrations };
}

/**
 * Apply every migration to an empty in-memory database and export the resulting
 * schema without application data.
 *
 * @param {string} [repositoryRoot]
 */
export async function createSchemaBackup(repositoryRoot = defaultRepositoryRoot) {
  const { migrations } = await loadMigrationSources(repositoryRoot);
  const requireFromServer = createRequire(join(repositoryRoot, 'apps', 'server', 'package.json'));
  const Database = requireFromServer('better-sqlite3');
  const database = new Database(':memory:');

  try {
    database.pragma('foreign_keys = ON');

    for (const migration of migrations) {
      database.transaction(() => database.exec(migration.sql))();
    }

    const statements = database
      .prepare(
        `
        SELECT type, name, sql
        FROM sqlite_schema
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
        ORDER BY
          CASE type
            WHEN 'table' THEN 1
            WHEN 'index' THEN 2
            WHEN 'trigger' THEN 3
            WHEN 'view' THEN 4
            ELSE 5
          END,
          name
      `,
      )
      .all()
      .map((row) => `${row.sql.trim().replace(/;+$/u, '')};`);
    const schemaVersion = migrations.at(-1).version;
    const sql = [
      '-- Shopee Price Tracker empty database schema backup.',
      `-- Generated from migrations 001-${String(schemaVersion).padStart(3, '0')}.`,
      'PRAGMA foreign_keys = ON;',
      '',
      'BEGIN TRANSACTION;',
      '',
      statements.join('\n\n'),
      '',
      `PRAGMA user_version = ${schemaVersion};`,
      'COMMIT;',
      '',
    ].join('\n');
    const verificationDatabase = new Database(':memory:');

    try {
      verificationDatabase.exec(sql);

      if (verificationDatabase.pragma('user_version', { simple: true }) !== schemaVersion) {
        throw new Error('Generated schema backup did not preserve the migration version');
      }
    } finally {
      verificationDatabase.close();
    }

    return {
      migrations: migrations.map(({ filename, sha256, version }) => ({
        filename,
        sha256,
        version,
      })),
      schemaVersion,
      sql,
    };
  } finally {
    database.close();
  }
}

/**
 * Create the versioned local release bundle.
 *
 * @param {object} [options]
 * @param {string} [options.extensionBuildDirectory]
 * @param {string} [options.generatedAt]
 * @param {string} [options.outputBase]
 * @param {string} [options.repositoryRoot]
 */
export async function prepareRelease({
  extensionBuildDirectory,
  generatedAt = new Date().toISOString(),
  outputBase,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const metadata = await loadReleaseMetadata(repositoryRoot);
  const releaseBase = outputBase ?? join(repositoryRoot, 'dist', 'releases');
  const releaseDirectory = join(releaseBase, `shopee-price-tracker-v${metadata.version}`);
  const extensionDirectory = extensionBuildDirectory ?? join(repositoryRoot, 'dist', 'extension');
  const builtManifest = await readJson(join(extensionDirectory, 'manifest.json'));

  if (builtManifest.version !== metadata.version) {
    throw new Error(
      `Built extension version ${builtManifest.version} does not match release ${metadata.version}`,
    );
  }

  assertSafeReleaseDirectory(releaseBase, releaseDirectory);
  await rm(releaseDirectory, { force: true, recursive: true });
  await mkdir(releaseDirectory, { recursive: true });
  await cp(extensionDirectory, join(releaseDirectory, 'extension'), { recursive: true });

  for (const relativePath of releaseDocumentation) {
    const destination = join(releaseDirectory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repositoryRoot, relativePath), destination);
  }

  const schemaBackup = await createSchemaBackup(repositoryRoot);
  const schemaDirectory = join(releaseDirectory, 'database-schema');
  await mkdir(schemaDirectory, { recursive: true });
  await writeFile(
    join(schemaDirectory, `schema-v${schemaBackup.schemaVersion}.sql`),
    schemaBackup.sql,
    'utf8',
  );
  await cp(
    join(repositoryRoot, 'apps', 'server', 'src', 'db', 'migrations'),
    join(schemaDirectory, 'migrations'),
    { recursive: true },
  );

  const releaseManifest = {
    database: {
      migrations: schemaBackup.migrations,
      schemaVersion: schemaBackup.schemaVersion,
    },
    extension: {
      manifestVersion: builtManifest.manifest_version,
      minimumChromeVersion: builtManifest.minimum_chrome_version,
      version: builtManifest.version,
    },
    generatedAt,
    nodeEngine: metadata.nodeEngine,
    product: 'Shopee Price Tracker',
    releaseVersion: metadata.version,
    schemaVersion: 1,
  };
  await writeFile(
    join(releaseDirectory, 'RELEASE-MANIFEST.json'),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
    'utf8',
  );

  const releaseFiles = (await listFiles(releaseDirectory)).sort((left, right) =>
    left.localeCompare(right),
  );
  const checksumLines = await Promise.all(
    releaseFiles.map(async (filePath) => {
      const relativePath = relative(releaseDirectory, filePath).replaceAll('\\', '/');
      return `${await sha256File(filePath)}  ${relativePath}`;
    }),
  );
  await writeFile(
    join(releaseDirectory, 'CHECKSUMS.sha256'),
    `${checksumLines.join('\n')}\n`,
    'utf8',
  );

  return {
    fileCount: releaseFiles.length + 1,
    releaseDirectory,
    schemaVersion: schemaBackup.schemaVersion,
    version: metadata.version,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await prepareRelease();
  process.stdout.write(
    `Release prepared: v${result.version}, schema v${result.schemaVersion}, ${result.fileCount} files -> ${result.releaseDirectory}\n`,
  );
}
