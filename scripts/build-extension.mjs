import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { generateExtensionIcons } from './generate-extension-icons.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = join(repositoryRoot, 'apps', 'extension');
const outputDirectory = join(repositoryRoot, 'dist', 'extension');

const scriptEntryPoints = [
  'service-worker.js',
  'content/page-interceptor.js',
  'content/content-bridge.js',
  'popup/popup.js',
  'options/options.js',
];
const staticFiles = [
  'manifest.json',
  'popup/popup.html',
  'popup/popup.css',
  'options/options.html',
  'options/options.css',
];

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

async function copyStaticFile(filePath) {
  const destination = join(outputDirectory, filePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(sourceDirectory, filePath), destination);
}

async function rejectRemoteExecutable(files) {
  for (const filePath of files.filter((value) => /\.(?:html|js)$/u.test(value))) {
    const source = await readFile(filePath, 'utf8');
    const hasRemoteExecutable =
      /<script[^>]+src=["']https?:\/\//iu.test(source) ||
      /\bimport\s*(?:\(|[^'";]*from\s*)["']https?:\/\//u.test(source);

    if (hasRemoteExecutable) {
      throw new Error(`Remote executable code is not allowed: ${filePath}`);
    }
  }
}

/** Bundle and validate the loadable MV3 extension in the generated dist directory. */
async function buildExtension() {
  const manifestPath = join(sourceDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    throw new Error('Extension manifest_version must be 3');
  }

  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(staticFiles.map(copyStaticFile));
  await build({
    bundle: true,
    entryPoints: scriptEntryPoints.map((entry) => join(sourceDirectory, entry)),
    format: 'iife',
    legalComments: 'none',
    outbase: sourceDirectory,
    outdir: outputDirectory,
    platform: 'browser',
    target: ['chrome116'],
  });

  const iconDirectory = join(outputDirectory, 'icons');
  await mkdir(iconDirectory, { recursive: true });
  await generateExtensionIcons(iconDirectory);

  const outputFiles = await listFiles(outputDirectory);
  await rejectRemoteExecutable(outputFiles);

  const requiredManifestFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((contentScript) => contentScript.js),
  ];
  const outputRelativePaths = new Set(
    outputFiles.map((filePath) => relative(outputDirectory, filePath).replaceAll('\\', '/')),
  );

  for (const requiredFile of requiredManifestFiles) {
    if (!outputRelativePaths.has(requiredFile)) {
      throw new Error(`Manifest references a missing extension file: ${requiredFile}`);
    }
  }

  return { fileCount: outputFiles.length, outputDirectory };
}

const result = await buildExtension();
process.stdout.write(`Extension built: ${result.fileCount} files -> ${result.outputDirectory}\n`);
