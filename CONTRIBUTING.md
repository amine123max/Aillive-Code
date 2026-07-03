# Contributing

Thank you for improving Aillive Code.

## Local Setup

```bash
git clone https://github.com/amine123max/Aillive-Code.git
cd Aillive-Code
npm install
npm run publish:check
```

## Development Rules

- Keep the CLI dependency-light unless a dependency removes meaningful complexity.
- Keep configuration and auth under `~/.aillive`; do not write secrets into project folders.
- Preserve both command aliases: `aillive` and `aillive-code`.
- Prefer stable, script-friendly output for `--json`.
- Do not log API keys, provider keys, auth tokens, verification codes, or raw `auth.json` content.

## Pull Request Checklist

- `npm run check`
- `npm test`
- `npm run smoke:npx`
- `npm run pack:dry`
- README and CHANGELOG updated when commands or behavior change
