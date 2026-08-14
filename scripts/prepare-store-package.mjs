import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadReleaseMetadata } from './prepare-release.mjs';
import { writeDirectoryZip } from './zipArchive.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '..');
const allowedHostPermissions = new Set([
  'https://shopee.vn/*',
  'https://*.shopee.vn/*',
  'http://127.0.0.1/*',
  'http://localhost/*',
]);

function assertSafeOutputDirectory(repositoryRoot, outputDirectory) {
  const expectedBase = resolve(repositoryRoot, 'dist');
  const relativeTarget = relative(expectedBase, resolve(outputDirectory));

  if (
    relativeTarget === '' ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..\\`) ||
    relativeTarget.startsWith('../') ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(`Unsafe Chrome Web Store output directory: ${outputDirectory}`);
  }
}

function validateStoreManifest(manifest, version) {
  if (manifest.manifest_version !== 3) {
    throw new Error('Chrome Web Store package must use Manifest V3');
  }

  if (manifest.version !== version) {
    throw new Error(
      `Built extension version ${manifest.version} does not match release ${version}`,
    );
  }

  if (manifest.optional_host_permissions?.length) {
    throw new Error('Local-only Store package must not declare optional host permissions');
  }

  const unexpectedHosts = (manifest.host_permissions ?? []).filter(
    (permission) => !allowedHostPermissions.has(permission),
  );

  if (unexpectedHosts.length > 0) {
    throw new Error(
      `Local-only Store package declares unexpected hosts: ${unexpectedHosts.join(', ')}`,
    );
  }

  if (manifest.content_security_policy?.extension_pages?.includes('https:')) {
    throw new Error('Local-only Store package CSP must not allow arbitrary HTTPS connections');
  }
}

/** Create the Chrome Web Store upload ZIP and its SHA-256 checksum. */
export async function prepareStorePackage({
  extensionBuildDirectory,
  outputDirectory,
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const metadata = await loadReleaseMetadata(repositoryRoot);
  const extensionDirectory = extensionBuildDirectory ?? join(repositoryRoot, 'dist', 'extension');
  const storeOutputDirectory = outputDirectory ?? join(repositoryRoot, 'dist', 'chrome-web-store');
  const manifest = JSON.parse(await readFile(join(extensionDirectory, 'manifest.json'), 'utf8'));
  validateStoreManifest(manifest, metadata.version);
  assertSafeOutputDirectory(repositoryRoot, storeOutputDirectory);

  await rm(storeOutputDirectory, { force: true, recursive: true });
  await mkdir(storeOutputDirectory, { recursive: true });

  const archivePath = join(
    storeOutputDirectory,
    `shopee-price-tracker-v${metadata.version}-chrome-web-store.zip`,
  );
  const archive = await writeDirectoryZip(extensionDirectory, archivePath);

  if (archive.entryNames[0] === undefined || !archive.entryNames.includes('manifest.json')) {
    throw new Error('Chrome Web Store archive must contain manifest.json at its root');
  }

  if (archive.entryNames.some((entryName) => entryName.startsWith('extension/'))) {
    throw new Error('Chrome Web Store archive must not wrap files in an extension directory');
  }

  const checksum = createHash('sha256')
    .update(await readFile(archivePath))
    .digest('hex');
  const checksumPath = `${archivePath}.sha256`;
  await writeFile(checksumPath, `${checksum}  ${basename(archivePath)}\n`, 'utf8');

  return {
    archivePath,
    checksum,
    checksumPath,
    entryCount: archive.entryNames.length,
    size: archive.size,
    version: metadata.version,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await prepareStorePackage();
  process.stdout.write(
    `Chrome Web Store package prepared: v${result.version}, ${result.entryCount} files, ${result.size} bytes -> ${result.archivePath}\n`,
  );
}
