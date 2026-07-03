# Git

## Purpose

`packages/git` provides read-only repository awareness for Aillive: repo detection, branch, HEAD, clean/dirty status, diff summaries, staged summaries, untracked files, recent commits, checkpoint metadata, and agent protection context.

## Commands

- `aillive git status`
- `aillive git diff --summary`
- `aillive git checkpoint`

## Config

Git commands run in `--cwd` or the current directory. The package uses read-only Git commands such as `rev-parse`, `status --short`, `diff --stat`, `diff --cached --stat`, and `log`.

## Failure Modes

Non-repositories return `not-a-repository`. Missing Git returns `unavailable`. Dirty worktrees are surfaced to the agent runtime so code edits can be protected by safety gates.

## Test Expectations

`packages/git/test/git.test.js` covers non-repo, clean, dirty, staged, unstaged, untracked, diff summary, checkpoint metadata, and agent context.
