# Provider

## Purpose

`packages/provider` owns Aillive and OpenAI-compatible HTTP behavior: model metadata, chat completions, streaming, usage, OpenClaw tasks, retries, timeouts, and redacted traces.

## Commands

- `aillive provider status`
- `aillive models`
- `aillive chat`
- `aillive chat --stream`
- `aillive usage`
- `aillive openclaw run`

## Config

Provider config comes from `--api-key`, `--base-url`, `--model`, environment variables, `~/.aillive/auth.json`, and `~/.aillive/config.json`.

## Failure Modes

Missing auth reports a login/setup hint. Invalid base URLs report `invalid-config`. Network or HTTP failures produce provider errors with status and payload where available. Authorization headers are redacted from trace events.

## Test Expectations

`packages/provider/test/provider.test.js` uses local HTTP mocks for models, chat, streaming SSE, usage, OpenClaw, status checks, retries/timeouts, and provider error payloads.
