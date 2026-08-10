import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.example',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
]);
const TELEGRAM_TOKEN_PATTERN = /(?:^|[^A-Za-z0-9])\d{6,12}:[A-Za-z0-9_-]{30,}(?:$|[^A-Za-z0-9_-])/u;

function repositoryFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replaceAll('\\', '/'));
}

describe('repository privacy boundary', () => {
  it('does not track local environment, database, log, or Chrome-profile state', () => {
    const forbidden = repositoryFiles().filter((file) => {
      const lower = file.toLowerCase();
      const segments = lower.split('/');

      return (
        (lower.startsWith('.env') && lower !== '.env.example') ||
        /\.(?:db|db-shm|db-wal|log|sqlite|sqlite3)$/u.test(lower) ||
        segments.some((segment) =>
          ['.chrome-profile', 'chrome-profile', 'user data', 'user-data'].includes(segment),
        )
      );
    });

    expect(forbidden).toEqual([]);
  });

  it('keeps generated private-state locations ignored', () => {
    for (const candidate of [
      '.env',
      'data/phase12-audit.db',
      'dist/extension/manifest.json',
      'chrome-profile/Default/Cookies',
      'user-data/Default/Login Data',
    ]) {
      const result = spawnSync('git', ['check-ignore', '--no-index', '--quiet', '--', candidate], {
        cwd: REPOSITORY_ROOT,
      });

      expect(result.status, `${candidate} should be ignored`).toBe(0);
    }
  });

  it('does not contain a Telegram Bot API token in tracked text files', () => {
    const leakedFiles = repositoryFiles().filter((file) => {
      if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        return false;
      }

      return TELEGRAM_TOKEN_PATTERN.test(readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8'));
    });

    expect(leakedFiles).toEqual([]);
  });
});
