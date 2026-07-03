# MCP

## Purpose

`packages/mcp` provides the Aillive MCP and tool contract layer: config parsing, server definitions, offline mock servers, tool listing, tool calls, permission policy, trace recording, output limits, and redaction.

## Commands

- `aillive mcp status`
- `aillive mcp list`
- `aillive mcp call <tool> [json-args]`

## Config

MCP config is read from `~/.aillive/mcp.json`.

```json
{
  "servers": {
    "local": {
      "transport": "mock",
      "tools": {
        "canned": { "description": "Offline response", "risk": "read", "response": "ok" }
      }
    }
  }
}
```

Supported transport declarations are `mock`, `stdio`, `sse`, and `http`. Current CI uses `mock`; real process startup is intentionally deferred behind the same config contract.

## Failure Modes

Invalid config returns `invalid-config`. Unknown tools fail. Denied tools are blocked. High-risk tools such as filesystem, shell, write, or network tools require confirmation. Tool output is size-limited and trace output redacts secrets.

## Test Expectations

`packages/mcp/test/mcp.test.js` covers Aillive tool contracts, adapter status, config parsing, mock list/call, high-risk confirmations, deny rules, output trimming, and trace redaction.
