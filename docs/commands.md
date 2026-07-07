# Commands

## Purpose

Document the public Aillive CLI command surface for users, scripts, and maintainers. Commands keep Aillive naming and stable JSON output.

## Commands

- `aillive`, `aillive interactive`: open the terminal UI.
- `aillive ask|chat|run`: call chat or project-aware execution.
- `aillive agent plan|run|verify|resume`: run offline agent planning, execution, verification, and checkpoint resume.
- `aillive provider|mcp|lsp|git|memory status`: inspect subsystem readiness.
- `aillive install managed`: install the active CLI package and command shims under `~/.aillive`.
- `aillive mcp list|call`: list configured tools or call the built-in/mock tool contract.
- `aillive git diff --summary|checkpoint`: inspect read-only Git evidence.
- `aillive config|auth|home|context|session|stats|usage|openclaw|admin|doctor|completions`: manage local Aillive workflows.

## Config

Global flags include `--json`, `--no-color`, `--api-key`, `--base-url`, `--model`, `--project`, `--no-project`, `--system`, `--cwd`, `--data-dir`, `--open`, `--offline`, `--trace`, `--verify`, and `--force`.

## Failure Modes

Commands return concise human errors. Automation should use `--json` and check exit code. API commands fail fast when auth is missing in non-interactive shells.

## Test Expectations

`test/cli.test.js` covers help, version, home, status, config, context, chat mock, streaming mock, agent commands, architecture status, MCP call, Git diff/checkpoint, and memory search.
