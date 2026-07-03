# Aillive Code Architecture

Aillive Code is structured as a publishable root npm package with workspace packages underneath it. The root package keeps the public npm name `aillive-code` and exposes the installed commands `aillive` and `aillive-code`.

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
