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
