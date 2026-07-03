# Agent Runtime

## Purpose

`packages/agent-runtime` owns deterministic agent execution: objective model, context assembly, planning, provider orchestration, MCP tool routing, LSP/Git/memory context, verification hooks, trace events, checkpoints, resume, and safety gates.

## Commands

- `aillive agent plan "task"`
- `aillive agent run "task"`
- `aillive agent run --verify "task"`
- `aillive agent verify`
- `aillive agent resume [checkpoint]`
- `aillive runtime status`

## Config

The runtime is offline by default and can use fake provider execution. Verification hooks default to `npm run check:syntax`, `npm test`, and `npm run pack:smoke`.

## Failure Modes

Invalid state transitions throw. Unknown tools throw. Safety gates deny destructive shell commands and secret-bearing traces, and require confirmation for large file edits, dirty Git worktrees before edits, and high-risk MCP tools.

## Test Expectations

`packages/agent-runtime/test/agent-runtime.test.js` covers state transitions, invalid transitions, fake provider execution, checkpoint resume, verification command injection, memory tier reads, MCP tool routing, safety detection, and runtime enforcement.
