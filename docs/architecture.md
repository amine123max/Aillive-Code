# Aillive Code Architecture

## Purpose

Aillive Code is structured as a publishable root npm package with workspace packages underneath it. The root package keeps the public npm name `aillive-code` and exposes the installed commands `aillive` and `aillive-code`.

## Commands

- `aillive runtime status`
- `aillive provider status`
- `aillive mcp status|list|call`
- `aillive lsp status`
- `aillive git status|diff --summary|checkpoint`
- `aillive memory status|search`
- `aillive agent plan|run|verify|resume`

## Config

The architecture reads local user configuration from `~/.aillive` or `AILLIVE_HOME`. Workspace package boundaries are enforced by `scripts/verify-workspace.mjs`, release metadata by `scripts/check-release.mjs`, and package contents by `scripts/pack-smoke.mjs`.

## Failure Modes

Subsystems report `disabled`, `unavailable`, `not-a-repository`, or `invalid-config` instead of crashing. Agent runtime safety gates deny destructive shell commands and secret-bearing traces, and require confirmation for large file edits, dirty Git worktrees before edits, and high-risk MCP tools.

## Test Expectations

`npm test` covers package contracts and CLI integration. `npm run publish:check` additionally runs workspace checks, syntax checks, release metadata checks, pack smoke, and pack dry-run.

## Package Map

| Package | Responsibility |
| --- | --- |
| `apps/cli` | CLI app, bin entrypoint, command dispatch, interactive shell orchestration |
| `packages/core` | Shared config, paths, parsing, errors, output modes, formatting, auth helpers |
| `packages/tui` | Terminal rendering, prompts, panels, tables, status chips, streaming output |
| `packages/provider` | Aillive and OpenAI-compatible model, chat, streaming, usage, and OpenClaw clients |
| `packages/mcp` | MCP server registry, tool schemas, invocation contracts, permission policies |
| `packages/lsp` | Language server discovery, diagnostics, symbols, definitions, references |
| `packages/git` | Repository detection, branch, status, diff summaries, checkpoint metadata |
| `packages/memory` | Config, auth, sessions, stats, project context, checkpoints, task traces |
| `packages/agent-runtime` | Planning, context assembly, tool routing, verification, checkpoints, resume |

## Dependency Rules

- `packages/core` does not depend on other internal packages.
- TUI, Provider, MCP, LSP, Git, and Memory may depend on Core only.
- Agent Runtime may depend on Core, Provider, MCP, LSP, Git, and Memory.
- `apps/cli` may depend on every internal package.
- Internal package APIs are exported through each package `exports` field.
- Circular dependencies are not allowed.

`npm run check:workspace` verifies the initial package graph and public entrypoints.

## Status Commands

The CLI exposes lightweight inspection commands for the new architecture:

```bash
aillive runtime status --json
aillive provider status --json
aillive mcp status --json
aillive lsp status --json
aillive git status --json
aillive memory status --json
```

These commands must work without real MCP servers, language servers, or API requests. They report disabled or unavailable subsystems explicitly so scripts can decide whether deeper agent execution is appropriate.

## Compatibility

The root `src/index.js` file is a compatibility shim. The real executable entrypoint lives at `apps/cli/src/index.js`, and the root package `bin` points to that app entrypoint. Existing tests and imports that use `src/index.js` continue to work while future code moves into packages.

## Batch 2 Extraction

The stable utility layer is now split out of the CLI app:

- `packages/core` owns version/default URL constants, Aillive path resolution, argv parsing, JSON read/write helpers, base URL normalization, auth header creation, safe JSON parsing, and secret masking.
- `packages/tui` owns color helpers, ANSI stripping, visible-width calculations, boxes, frames, command block formatting, terminal width helpers, status chips, wordmark selection, and elapsed-time formatting.
- `packages/memory` owns session reads/writes, stats reads/writes, project context reads with legacy fallback, and memory status inspection.

The CLI app still owns command dispatch and user-facing behavior. It imports these packages so tests can cover the stable layer independently while existing commands continue to work.

## Provider Extraction

`packages/provider` now owns the Aillive/OpenAI-compatible HTTP client layer:

- `listModels` calls `/models` and returns normalized model records with `id`, `label`, `owned_by`, `contextWindow`, and `supports` metadata.
- `createChatCompletion` calls `/chat/completions` for non-streaming chat.
- `streamChatCompletion` parses SSE events, including partial chunks, and reports deltas through callbacks so the CLI can keep terminal rendering separate from provider logic.
- `loadUsage` calls `/usage` with optional date filters.
- `runOpenClawTask` calls `/openclaw/v1/tasks` using the API root derived from the configured base URL.
- `checkProviderStatus` validates base URL/auth configuration and checks `/models` only when credentials are present.

Provider request tracing records method, path, status, attempt, and timeout metadata. Authorization headers are redacted before traces leave the package. Offline package tests use a local HTTP server and do not require a real API key.

## Runtime Subsystem Contracts

Git, LSP, and Agent Runtime now expose offline-testable contracts:

- `packages/git` performs read-only repository inspection with branch, HEAD, clean/dirty status, untracked files, diff summaries, staged diff summaries, recent commits, and checkpoint metadata.
- `packages/lsp` provides project language detection plus JSON-RPC encode/decode helpers, a mock transport, and a small client surface for initialize, shutdown, workspace symbols, diagnostics, hover, definitions, and references.
- `packages/agent-runtime` defines the agent state machine, validates transitions, records trace events, stores checkpoint metadata, and rejects unknown tool names.
- `packages/memory` stores task checkpoints and trace events under `~/.aillive/checkpoints` and `~/.aillive/traces`.
- `aillive agent plan|run|resume` provides an offline CLI bridge for planning, fake-provider execution, checkpoint creation, trace output, and checkpoint resume summaries.
- `aillive agent verify` and `aillive agent run --verify` execute the configured syntax, test, and pack-smoke verification hooks and store the resulting evidence in runtime events/checkpoints.

These packages still avoid starting real language servers or running tool-heavy agent tasks by default. The current contract gives the CLI and future runtime orchestration stable, testable boundaries without increasing first-install complexity.

## Release Engineering

The release gate is split into static and runtime checks:

- `scripts/check-release.mjs` verifies package metadata, bin aliases, package file allowlist, changelog coverage, release docs, and the manual GitHub release workflow guardrails.
- `scripts/pack-smoke.mjs` creates a real npm tarball, verifies the exact tarball file list, starts a mock Aillive API, and runs both `aillive` and `aillive-code` through npm execution.
- `npm run publish:check` runs workspace/syntax checks, release checks, tests, pack smoke, and pack dry-run before publishing.
- `.github/workflows/release.yml` is manual-only. It uploads a tarball artifact by default and publishes to npm only when `publish_to_npm` is explicitly enabled with `NPM_TOKEN`.

## External Package Review And Aillive Naming

Third-party AI CLI-related npm packages were reviewed before adding dependencies:

- `@mimo-ai/cli` is an MIT platform-binary CLI package. It is useful as an external reference, but it is not imported directly because Aillive must preserve its own `aillive` and `aillive-code` commands, browser auth flow, API protocol, local data layout, and release package.
- `@mimo-ai/plugin` is an MIT contract package with tool/TUI/plugin types. Aillive uses it only as an internal implementation source in `packages/mcp`.
- `@mimo-ai/sdk` is pulled transitively by `@mimo-ai/plugin` and remains a future candidate for explicit SDK adapters if Aillive needs compatible client/server contracts.

`packages/mcp` exposes `createAilliveTool`, `getAilliveToolSchema`, and `describeAilliveToolDefinition` so future Aillive MCP tools use Aillive public naming while still benefiting from the reused MIT contract internals.

Existing local data remains under `~/.aillive`:

```text
~/.aillive/
  auth.json
  config.json
  stats.json
  sessions/
  projects/
```

The architecture must preserve this layout unless a future migration is explicit, tested, and documented.
