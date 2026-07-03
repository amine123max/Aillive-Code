# Testing

## Purpose

Keep Aillive Code verifiable offline across package contracts, CLI integration, release gates, and npm tarball smoke tests.

## Commands

- `npm run check`
- `npm run check:workspace`
- `npm run check:syntax`
- `npm test`
- `npm run smoke:npx`
- `npm run pack:smoke`
- `npm run pack:dry`
- `npm run publish:check`

## Config

Tests use temporary `AILLIVE_HOME` directories and local HTTP servers. They do not require real API keys, real MCP servers, or real language servers.

## Failure Modes

Workspace graph violations fail `check:workspace`. Syntax errors fail `check:syntax`. Package or CLI regressions fail `npm test`. Tarball content or executable alias regressions fail `pack:smoke`.

## Test Expectations

CI runs Node 18, 20, and 22 on Ubuntu with install, workspace graph, syntax, release metadata, unit/integration tests, pack smoke, and pack dry-run.
