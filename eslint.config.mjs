import eslint from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'chrome-extension/**',
      'coverage/**',
      'data/**',
      'dist/**',
      'node_modules/**',
      'phase1/**',
      'tests/fixtures/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: [
      'apps/server/**/*.js',
      'packages/shared/**/*.js',
      'scripts/**/*.mjs',
      'tests/unit/**/*.js',
      'tests/integration/**/*.{js,mjs}',
      '*.config.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['apps/server/public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      sourceType: 'module',
    },
  },
  {
    files: ['apps/extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
      sourceType: 'module',
    },
  },
];
