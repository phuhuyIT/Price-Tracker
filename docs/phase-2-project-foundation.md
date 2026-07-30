# Phase 2 — Project Foundation

Status: **complete — verified 2026-07-28**

## Scope

Phase 2 adds the maintainable application foundation without implementing the
Phase 3 product-snapshot contract or later tracking business logic. The Phase 1
collector remains available through the `legacy:*` scripts while the new code
uses scoped ES modules under `apps/server` and `packages/shared`.

## Delivered

- npm workspaces for the server and shared package
- loadable Manifest V3 extension shell and deterministic local build
- Node.js 20 engine declaration and `.env.example`
- Zod startup configuration validation, including the unauthenticated
  loopback-only rule and variant-lifecycle controls
- Pino structured logging with sensitive-field redaction
- central application errors and standard API response helpers
- minimal Express server with a health endpoint and graceful shutdown
- ESLint, Prettier and Vitest configuration
- unit and integration tests for configuration, response envelopes and server
  startup
- scripts for development, production, tests, migration readiness, Playwright
  installation, extension build and anonymous Playwright connectivity

## Phase boundary

The migration command validates the configured database destination but does
not create a database. Schema migrations begin in Phase 4. The extension shell
does not capture product data; shared schemas and collector integration begin
in Phases 3 and 6.

## Verification

Run:

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run test:foundation
npm.cmd run extension:build
npm.cmd start
```

The full `npm.cmd test` command also runs preserved Phase 1 browser integration
tests and therefore requires an installed Playwright Chromium executable.

Final verification passed:

- ESLint and Prettier checks
- 15 Phase 2 Vitest assertions across three test files
- all six preserved Phase 1 test commands, including both browser integrations
- Manifest V3 extension build
- migration-readiness command
- npm security audit with zero reported vulnerabilities
