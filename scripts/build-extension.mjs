import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(repositoryRoot, 'apps', 'extension');
const outputDirectory = join(repositoryRoot, 'dist', 'extension');

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

/**
 * Validate and copy the unpacked MV3 extension to the generated dist directory.
 *
 * @returns {Promise<{fileCount: number, outputDirectory: string}>}
 */
export async function buildExtension() {
  const manifestPath = join(sourceDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    throw new Error('Extension manifest_version must be 3');
  }

  const sourceFiles = await listFiles(sourceDirectory);
  const executableFiles = sourceFiles.filter((filePath) => /\.(?:html|js)$/u.test(filePath));

  for (const filePath of executableFiles) {
    const source = await readFile(filePath, 'utf8');
    const hasRemoteExecutable =
      /<script[^>]+src=["']https?:\/\//iu.test(source) ||
      /\bimport\s*(?:\(|[^'"]*from\s*)["']https?:\/\//u.test(source);

    if (hasRemoteExecutable) {
      throw new Error(`Remote executable code is not allowed: ${filePath}`);
    }
  }

  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(dirname(outputDirectory), { recursive: true });
  await cp(sourceDirectory, outputDirectory, { recursive: true });

  return {
    fileCount: sourceFiles.length,
    outputDirectory,
  };
}

const result = await buildExtension();
process.stdout.write(`Extension built: ${result.fileCount} files -> ${result.outputDirectory}\n`);
