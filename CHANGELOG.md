# Changelog

## 0.1.0 - 2026-07-03

- Initial Aillive Code npm CLI package.
- Added `aillive` and `aillive-code` command aliases.
- Added interactive terminal with Droid-like AILLIVE wordmark, slash commands, browser login, project context, real working timer, and responsive terminal width handling.
- Added chat, stream chat, one-shot prompts, project run, models, usage, OpenClaw tasks, local sessions, stats, config, auth, doctor, completions, and admin promote commands.
- Stored auth and config under `~/.aillive`, including `~/.aillive/auth.json`.
- Added Node test coverage, local API mocks, npx tarball smoke test, and GitHub Actions CI.
- Added real rendered terminal screenshot asset for GitHub and npm README pages.
- Added bilingual README entry points and Website/Docs/GitHub links.
- Added Batch 1 workspace architecture skeleton with `apps/cli`, internal packages, workspace verification, and syntax check scripts.
- Added architecture status commands for runtime, provider, MCP, LSP, Git, and memory readiness.
- Extracted stable Core, TUI, and Memory utilities into package-level APIs with offline package tests.
- Added an Aillive MCP tool adapter, with the MIT `@mimo-ai/plugin` contract reused only as an internal implementation source.
- Extracted Provider clients for models, chat, streaming, usage, OpenClaw, status checks, normalized model metadata, timeout/retry policy, and redacted request traces with local HTTP mock tests.
- Added release checks, pack smoke validation, CI release metadata checks, and a manual GitHub release workflow with optional npm provenance publishing.
- Added Git, LSP, and Agent Runtime package contracts with tests for read-only Git status, mock JSON-RPC LSP behavior, and validated agent state transitions.
- Added offline `aillive agent plan|run|resume` commands plus `agent verify` and `agent run --verify` with checkpoint memory, trace events, fake-provider execution, command verification hooks, and resume summaries.
- Added Aillive-named MCP tool contracts with config parsing, offline mock tool calls, permission policy, output limits, and trace redaction.
- Added Agent Runtime safety gates for destructive shell commands, secret traces, large file edits, dirty Git worktrees, and high-risk MCP tools.
- Added subsystem docs for commands, provider, MCP, LSP, Git, memory, agent runtime, testing, and release, with release checks enforcing documentation shape.
- Added `test:integration` and CLI integration coverage for help/version/status/config/context/chat/streaming/MCP/Git/memory workflows.
