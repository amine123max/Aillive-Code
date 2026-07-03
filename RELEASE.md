# Release Guide

## One-Time Setup

```bash
npm adduser
```

Confirm npm auth:

```bash
npm whoami
```

## Verify

```bash
npm run publish:check
```

## Publish

```bash
npm version patch
git push origin main --tags
npm publish
```

## Install Test

```bash
npm install -g aillive-code
aillive --version
npx aillive-code chat "Hello Aillive"
```
