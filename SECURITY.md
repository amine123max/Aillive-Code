# Security Policy

## Supported Versions

The current supported line is `0.1.x`.

## Reporting a Vulnerability

Please report security issues privately to the repository owner instead of opening a public issue.

Include:

- Affected command or code path
- Reproduction steps
- Impact
- Suggested fix, if known

Do not include real API keys, `auth.json`, provider credentials, production logs, or private user data.

## Secret Handling

Aillive Code stores sensitive local auth data under:

```text
~/.aillive/auth.json
```

Never commit:

- `.env`
- `auth.json`
- `.aillive/`
- API keys
- provider keys
- SQLite databases
- log files
- npm tarballs
