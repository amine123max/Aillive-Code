# Aillive Code

Aillive Code is a standalone npm CLI for Aillive. It brings Aillive chat, project context, OpenAI-compatible APIs, OpenClaw tasks, usage queries, local sessions, and a polished terminal interface into one command.

This repository is designed to be published as the npm package `aillive-code`. The installed commands are:

- `aillive`
- `aillive-code`

The product structure is inspired by mature AI coding CLIs such as MiMo Code, Codex, Claude Code, and Droid: quick install, browser login, slash commands, project memory, one-shot execution, local configuration, and CI-friendly JSON output. Aillive Code keeps its own command names, auth flow, API protocol, and local data layout.

## Quick Start

Install from npm after the package is published:

```bash
npm install -g aillive-code
aillive --version
aillive auth login
aillive doctor
aillive
```

Run without installing:

```bash
npx aillive-code chat "Hello Aillive"
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
/login       Open browser login and wait for auth.json
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

Manual auth import:

```bash
aillive auth import auth.json
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
| Project | `aillive init`, `aillive run --project`, `aillive context status/show/path/init` |
| Models | `aillive models` |
| Usage | `aillive usage --from 2026-07-01 --to 2026-07-31 --json` |
| OpenClaw | `aillive openclaw run "Create a WeChat support workflow"` |
| Local | `aillive home`, `aillive session list`, `aillive stats` |
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
--json               Print JSON output
--no-color           Disable ANSI colors
```

## Developer Workflow

```bash
npm run check
npm test
npm run smoke:npx
npm run pack:dry
npm run publish:check
```

`npm run smoke:npx` creates a temporary packed tarball, starts a mock Aillive API, and verifies that `npx <tarball> chat --json "Hello"` can call the CLI through npm's execution path.

## Publishing

The npm package name is `aillive-code`.

Before publishing:

```bash
npm whoami
npm run publish:check
npm publish
```

If `npm whoami` fails, log in first:

```bash
npm adduser
```

After publish, users can install:

```bash
npm install -g aillive-code
npx aillive-code chat "Hello"
```

## GitHub Release Checklist

1. Confirm `package.json` version.
2. Run `npm run publish:check`.
3. Confirm `npm pack --dry-run` only includes `src/`, `README.md`, `LICENSE`, and `package.json`.
4. Push `main`.
5. Create a GitHub release tag such as `v0.1.0`.
6. Publish to npm after login.

## Security

- Never commit `.env`, `auth.json`, API keys, provider keys, local databases, logs, or `.aillive/`.
- Revoke leaked API keys from Aillive Console immediately.
- Use separate API keys for local development, CI, and production.
- Use `--json` for automation and avoid printing secrets in logs.

## License

MIT
