# Release

## Purpose

Define the release gate for the publishable `aillive-code` npm package and keep accidental npm publishing opt-in.

## Commands

- `npm run check:release`
- `npm run pack:smoke`
- `npm run pack:dry`
- `npm run publish:check`
- `npm publish`

## Config

The root package publishes `aillive` and `aillive-code` bin aliases. Package contents are controlled by `package.json.files`. GitHub release publishing is manual-only through `.github/workflows/release.yml` and requires `publish_to_npm:true` plus `NPM_TOKEN`.

## Failure Modes

Missing changelog version headings, unexpected package files, broken bin aliases, missing release docs, or missing workflow guardrails fail `check:release`. Tarball execution failures fail `pack:smoke`.

## Test Expectations

`scripts/check-release.mjs`, `scripts/pack-smoke.mjs`, `test/npx-smoke.mjs`, and `test/workspace.test.js` prove metadata, allowlist, command aliases, package tests, and npm execution path.
