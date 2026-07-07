<div align="center">

# Aillive Code

<img src="docs/assets/aillive_code.png" alt="Aillive Code logo" width="920" />

**Aillive Code: a terminal AI assistant for chat, agents, APIs, and project work.**

[中文](README.zh.md) | English

[Website](https://www.aillive.xyz) | [Docs](https://www.aillive.xyz/docs/) | [GitHub](https://github.com/amine123max/Aillive-Code)

</div>

Aillive Code is a standalone npm CLI for Aillive. It brings Aillive chat, project context, OpenAI-compatible APIs, OpenClaw tasks, usage queries, local sessions, and a polished terminal interface into one command.

This repository is designed to be published as the npm package `@aillive/cli`. The installed commands are:

- `aillive`
- `aillive-code`

The product structure is inspired by mature AI coding CLIs: quick install, browser login, slash commands, project memory, one-shot execution, local configuration, and CI-friendly JSON output. Aillive Code keeps its own command names, auth flow, API protocol, and local data layout.

## Quick Start

Install from npm after the package is published:

```bash
npm install -g @aillive/cli
aillive --version
aillive auth login
aillive doctor
aillive
```

Run without installing:

```bash
npx @aillive/cli chat "Hello Aillive"
```

Install directly from GitHub before npm publication:

```bash
npm install -g github:amine123max/Aillive-Code
aillive --help
```

Install from a local checkout:

```bash
git clone https://github.com/amine123max/Aillive-Code.git
cd Aillive-Code
npm install -g .
aillive doctor
```

## Terminal Experience

Run `aillive` in any project directory to open the interactive terminal.

![Aillive Code interactive terminal](docs/assets/aillive-code-terminal.png)

The terminal opens even when you are not logged in. Aillive Code only starts browser auth when an API action needs it, such as chat, models, usage, or OpenClaw.

Useful slash commands:

```text
/help        Show interactive commands
/status      Show auth, model, context, home, authFile, workspace
/login       Open browser login; callback saves ~/.aillive/auth.json
/models      List server models
/context     Show project context status
/context on  Attach project memory for this terminal session
/usage       Show account usage
/doctor      Check local config and API availability
/sessions    Show local CLI sessions
/clear       Clear current terminal conversation
/exit        Quit
```

One-shot execution is available for scripts and quick prompts:

```bash
aillive "Summarize this project"
aillive chat --stream "Write a release checklist"
aillive run --project "Generate a concise README outline"
```

## Authentication

Recommended browser login:

```bash
aillive auth login
```

The browser callback writes `~/.aillive/auth.json` automatically. Keep the terminal open until Aillive prints the authenticated message.

```bash
aillive auth status
aillive auth path
```

Environment variables for CI:

```bash
set AILLIVE_API_KEY=ail_xxx
set AILLIVE_BASE_URL=https://www.aillive.xyz/api/v1
aillive chat --json "Hello"
```

Local config commands:

```bash
aillive config set base-url https://www.aillive.xyz/api/v1
aillive config set api-key ail_xxx
aillive config set model qwen2.5:0.5b
aillive config list
```

API keys and auth files are sensitive. Do not commit them.

## Local Files

Aillive Code stores user-level configuration under the computer user home directory:

```text
~/.aillive/
  auth.json
  config.json
  stats.json
  sessions/
    index.json
  checkpoints/
    index.json
  traces/
    index.json
  projects/
    <project-key>/
      project.md
```

On Windows:

```bash
aillive home
aillive home --open
```

Project context is stored under `~/.aillive/projects/<project-key>/project.md`. The CLI does not upload local files automatically. Context is sent only when you enable it:

```bash
aillive init
aillive context path
aillive context show
aillive run --project "Summarize the current project"
```

## Commands

| Area | Commands |
| --- | --- |
| Start | `aillive`, `aillive interactive`, `aillive setup`, `aillive doctor` |
| Auth | `aillive auth login`, `aillive auth import`, `aillive auth status`, `aillive logout` |
| Chat | `aillive ask`, `aillive chat`, `aillive chat --stream`, `aillive "prompt"` |
| Agent | `aillive agent plan "task"`, `aillive agent run "task"`, `aillive agent run --verify "task"`, `aillive agent verify`, `aillive agent resume [checkpoint]` |
| Project | `aillive init`, `aillive run --project`, `aillive context status/show/path/init` |
| Models | `aillive models` |
| Usage | `aillive usage --from 2026-07-01 --to 2026-07-31 --json` |
| OpenClaw | `aillive openclaw run "Create a WeChat support workflow"` |
| Local | `aillive home`, `aillive session list`, `aillive stats` |
| Architecture | `aillive runtime status`, `aillive provider status`, `aillive mcp status`, `aillive lsp status`, `aillive git status`, `aillive memory status` |
| Shell | `aillive completions powershell`, `aillive completions bash`, `aillive completions zsh` |
| Admin | `aillive admin promote admin@example.com --data-dir "../Web/data"` |

Global options:

```text
--api-key <key>      Override auth.json/env API key
--base-url <url>     Override Aillive API base URL
--model <model>      Override default model
--project            Include project context
--no-project         Disable project context for this request
--system <prompt>    Add a one-off system instruction
--cwd <dir>          Run with a different project directory
--data-dir <dir>     Local Aillive data directory for maintenance commands
--open               Open local folders in the system file manager
--offline            Prefer local fake-provider runtime paths
--trace              Include trace events where supported
--json               Print JSON output
--no-color           Disable ANSI colors
```

## Developer Workflow

Aillive Code is now organized as an npm workspace while the root package publishes the `@aillive/cli` npm artifact. The executable app lives in `apps/cli`, and the root `src/index.js` remains a compatibility shim for older imports and tests.

```text
apps/cli              CLI app and command entrypoint
packages/core         shared config, path, parsing, error, and formatting utilities
packages/tui          terminal rendering and interactive UI primitives
packages/provider     Aillive and OpenAI-compatible provider clients
packages/mcp          MCP registry and tool invocation contracts
packages/lsp          language server integration contracts
packages/git          repository inspection and checkpoint metadata
packages/memory       local sessions, stats, project memory, and checkpoints
packages/agent-runtime planning, tool routing, verification, and task traces
```

The first architecture batch keeps existing command behavior intact while creating package boundaries for future extraction.
Architecture status commands are available in human and JSON modes so automation can inspect subsystem readiness before deeper agent execution.
The stable utility layer has started moving into packages: Core handles config/path/parser/JSON/auth helpers, TUI handles terminal rendering helpers, and Memory handles local sessions, stats, and project context stores.
Provider calls are now owned by `packages/provider`: model listing, normalized model metadata, chat completions, SSE streaming, usage, OpenClaw tasks, timeout/retry policy, status checks, and redacted request traces.
Git, LSP, and Agent Runtime now expose offline-testable contracts for read-only repository inspection, mock JSON-RPC language intelligence, and validated agent state transitions with trace/checkpoint events.
The `aillive agent plan|run|resume` commands exercise that runtime offline, write checkpoint/trace memory under `~/.aillive`, and are safe to run without browser login. `aillive agent verify` and `aillive agent run --verify` run the configured syntax, test, and pack-smoke verification hooks.
Aillive MCP exposes its own Aillive tool contract. It reuses a small MIT third-party contract package only as an internal implementation source, while keeping all public API names, command names, auth, protocol, and local data layout under Aillive.
The agent runtime also enforces safety gates for destructive shell commands, secret-bearing traces, large file edits, dirty Git worktrees, and high-risk MCP tools.

```bash
npm install
npm run check
npm run check:release
npm test
npm run smoke:npx
npm run pack:smoke
npm run pack:dry
npm run publish:check
```

`npm run check:release` verifies release metadata, changelog version coverage, bin aliases, package file allowlist, and release docs.
`npm run pack:smoke` creates a temporary packed tarball, checks the tarball file list, starts a mock Aillive API, and verifies both `aillive` and `aillive-code` through npm's execution path. `npm run smoke:npx` remains a compatibility alias for the same pack smoke.

## Publishing

The npm package name is `@aillive/cli`.

Before publishing:

```bash
npm whoami
npm run check:release
npm run pack:smoke
npm run publish:check
npm publish
```

If `npm whoami` fails, log in first:

```bash
npm adduser
```

After publish, users can install:

```bash
npm install -g @aillive/cli
npx @aillive/cli chat "Hello"
```

## GitHub Release Checklist

1. Confirm `package.json` version.
2. Confirm `CHANGELOG.md` has a heading for the same version.
3. Run `npm run publish:check`.
4. Confirm `npm pack --dry-run` includes the CLI app, compatibility shim, internal packages, docs assets, README files, LICENSE, and package metadata only.
5. Push `main`.
6. Create a GitHub release tag such as `v0.1.0`.
7. Publish to npm after login.

The manual GitHub Actions `Release` workflow runs `npm run publish:check`, creates a tarball artifact, and does not publish by default. Set `publish_to_npm` to `true` only for an intentional npm release with `NPM_TOKEN` configured; the workflow publishes with npm provenance.

## Security

- Never commit `.env`, `auth.json`, API keys, provider keys, local databases, logs, or `.aillive/`.
- Revoke leaked API keys from Aillive Console immediately.
- Use separate API keys for local development, CI, and production.
- Use `--json` for automation and avoid printing secrets in logs.

## License

MIT
