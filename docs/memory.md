# Memory

## Purpose

`packages/memory` owns local Aillive stores: config, auth, sessions, stats, project context, checkpoints, task traces, memory tiers, and local search.

## Commands

- `aillive memory status`
- `aillive memory search <query>`
- `aillive session list`
- `aillive stats`
- `aillive context status|show|path|init`
- `aillive agent resume`

## Config

All user data lives under `~/.aillive` or `AILLIVE_HOME`:

- `auth.json`
- `config.json`
- `stats.json`
- `sessions/index.json`
- `projects/<project-key>/project.md`
- `checkpoints/index.json`
- `traces/index.json`

## Failure Modes

Missing files return safe fallbacks. Corrupt optional stores fall back to empty structures where possible. Project context is opt-in and sent only with `--project` or `project-context` config.

## Test Expectations

`packages/memory/test/memory.test.js` covers config/auth stores, sessions, stats, project context with legacy fallback, checkpoints, trace events, tier reads, status counts, and search.
