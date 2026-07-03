# LSP

## Purpose

`packages/lsp` provides language discovery, JSON-RPC framing, mock transport, client methods, diagnostics, symbols, hover, definitions, references, code action metadata, and agent-ready workspace summaries.

## Commands

- `aillive lsp status`

## Config

Language detection is file based, using markers such as `package.json`, `tsconfig.json`, `pyproject.toml`, `Cargo.toml`, and `go.mod`. Server specs are represented as command/args/cwd/stdio metadata and can be wired to real processes later.

## Failure Modes

No project markers returns `disabled`. Missing language servers are reported as unavailable, not fatal. JSON-RPC parse functions preserve partial buffers for streaming transports.

## Test Expectations

`packages/lsp/test/lsp.test.js` covers language detection, JSON-RPC encode/decode, mock initialize/shutdown, symbols, diagnostics, hover, code actions, lifecycle metadata, and agent workspace context.
