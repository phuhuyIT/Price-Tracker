import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { prepareStorePackage } from '../../scripts/prepare-store-package.mjs';
import { createZipArchive } from '../../scripts/zipArchive.mjs';

const repositoryRoot = process.cwd();

function zipEntryNames(archive) {
  const names = [];
  let offset = 0;

  while (offset <= archive.length - 46) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

describe('Chrome Web Store preparation', () => {
  it('creates a deterministic classic ZIP archive', () => {
    const entries = [
      { data: Buffer.from('{}\n'), name: 'manifest.json' },
      { data: Buffer.from('worker\n'), name: 'service-worker.js' },
    ];

    expect(createZipArchive(entries)).toEqual(createZipArchive(entries));
    expect(zipEntryNames(createZipArchive(entries))).toEqual([
      'manifest.json',
      'service-worker.js',
    ]);
  });

  it('packages the built extension with its manifest at the archive root', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shopee-store-package-'));
    const extensionDirectory = join(temporaryRoot, 'extension');

    try {
      await mkdir(join(extensionDirectory, 'content'), { recursive: true });
      await writeFile(
        join(extensionDirectory, 'manifest.json'),
        `${JSON.stringify({
          content_security_policy: {
            extension_pages:
              "default-src 'self'; connect-src http://127.0.0.1:* http://localhost:*",
          },
          host_permissions: [
            'https://shopee.vn/*',
            'https://*.shopee.vn/*',
            'http://127.0.0.1/*',
            'http://localhost/*',
          ],
          manifest_version: 3,
          version: '1.1.0',
        })}\n`,
        'utf8',
      );
      await writeFile(join(extensionDirectory, 'service-worker.js'), 'export {};\n', 'utf8');
      await writeFile(join(extensionDirectory, 'content', 'bridge.js'), '(() => {})();\n', 'utf8');

      const result = await prepareStorePackage({
        extensionBuildDirectory: extensionDirectory,
        outputDirectory: join(repositoryRoot, 'dist', 'test-store-package'),
        repositoryRoot,
      });
      const archive = await readFile(result.archivePath);
      const checksumFile = await readFile(result.checksumPath, 'utf8');

      expect(result).toMatchObject({ entryCount: 3, version: '1.1.0' });
      expect(zipEntryNames(archive)).toEqual([
        'content/bridge.js',
        'manifest.json',
        'service-worker.js',
      ]);
      expect(checksumFile).toContain(createHash('sha256').update(archive).digest('hex'));
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
      await rm(join(repositoryRoot, 'dist', 'test-store-package'), {
        force: true,
        recursive: true,
      });
    }
  });

  it('rejects optional or remote host access in a local-only Store manifest', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'shopee-store-reject-'));

    try {
      await writeFile(
        join(temporaryRoot, 'manifest.json'),
        `${JSON.stringify({
          content_security_policy: { extension_pages: "default-src 'self'; connect-src https:" },
          host_permissions: ['https://tracker.example.com/*'],
          manifest_version: 3,
          optional_host_permissions: ['https://*/*'],
          version: '1.1.0',
        })}\n`,
        'utf8',
      );

      await expect(
        prepareStorePackage({
          extensionBuildDirectory: temporaryRoot,
          outputDirectory: join(repositoryRoot, 'dist', 'test-store-reject'),
          repositoryRoot,
        }),
      ).rejects.toThrow('must not declare optional host permissions');
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
      await rm(join(repositoryRoot, 'dist', 'test-store-reject'), {
        force: true,
        recursive: true,
      });
    }
  });
});
