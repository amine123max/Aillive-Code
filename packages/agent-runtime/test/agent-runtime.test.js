import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agentStates,
  assembleAgentContext,
  assertKnownTool,
  assertSafetyGates,
  createAgentRun,
  defaultVerificationCommands,
  evaluateSafetyGates,
  getRuntimeStatus,
  isDestructiveShellCommand,
  isValidTransition,
  planAgentTask,
  recordRuntimeEvent,
  resumeAgentRun,
  readRuntimeMemory,
  routeMcpToolCalls,
  runAgentTask,
  runCommandVerifications,
  SafetyGateError,
  transitionAgentRun,
} from '../src/index.js'

test('agent runtime exposes a deterministic state machine', () => {
  assert.equal(agentStates[0], 'created')
  assert.equal(agentStates.includes('completed'), true)
  assert.equal(isValidTransition('created', 'loaded_context'), true)
  assert.equal(isValidTransition('created', 'completed'), false)
})

test('agent runtime transitions through planning, execution, verification, and checkpointing', () => {
  let run = createAgentRun({
    id: 'run_test',
    objective: 'Summarize project',
    now: '2026-07-03T00:00:00.000Z',
  })
  run = transitionAgentRun(run, 'loaded_context', { source: 'memory', at: '2026-07-03T00:00:01.000Z' })
  run = transitionAgentRun(run, 'planned', { steps: 2, at: '2026-07-03T00:00:02.000Z' })
  run = transitionAgentRun(run, 'executing', { at: '2026-07-03T00:00:03.000Z' })
  run = recordRuntimeEvent(run, 'tool_call', { tool: 'provider.chat', at: '2026-07-03T00:00:04.000Z' })
  run = transitionAgentRun(run, 'verifying', { at: '2026-07-03T00:00:05.000Z' })
  run = transitionAgentRun(run, 'checkpointed', {
    checkpointId: 'checkpoint_test',
    files: ['task.md'],
    summary: 'verified',
    at: '2026-07-03T00:00:06.000Z',
  })
  run = transitionAgentRun(run, 'completed', { at: '2026-07-03T00:00:07.000Z' })

  assert.equal(run.state, 'completed')
  assert.equal(run.events.length, 8)
  assert.equal(run.checkpoints[0].id, 'checkpoint_test')
  assert.deepEqual(run.checkpoints[0].files, ['task.md'])
})

test('agent runtime rejects invalid transitions and unknown tools', () => {
  const run = createAgentRun({ objective: 'Invalid jump' })

  assert.throws(() => transitionAgentRun(run, 'completed'), /Invalid agent transition/)
  assert.throws(() => transitionAgentRun(run, 'missing_state'), /Unknown agent state/)
  assert.throws(() => assertKnownTool({ read: () => {} }, 'write'), /Unknown tool/)
  assert.equal(assertKnownTool({ read: () => 'ok' }, 'read')(), 'ok')
})

test('runtime status reports unavailable subsystems and active state machine', () => {
  const status = getRuntimeStatus({
    subsystems: [
      { component: 'provider', status: 'ready' },
      { component: 'mcp', status: 'disabled' },
    ],
  })

  assert.equal(status.status, 'active')
  assert.equal(status.readyForAgentRun, false)
  assert.deepEqual(status.unavailable, ['mcp'])
  assert.equal(status.transitions.created.includes('loaded_context'), true)
})

test('agent runtime plans and executes a fake provider task offline', async () => {
  const checkpoints = []
  const traces = []
  const result = await runAgentTask({
    id: 'run_fake',
    objective: 'Summarize release state',
    context: {
      project: { content: 'Aillive CLI' },
      git: { status: 'clean', branch: 'main' },
      lsp: { status: 'available-for-project', detectedLanguages: ['javascript'] },
    },
    verificationHooks: [
      () => ({ name: 'fake-tests', ok: true, detail: 'offline' }),
    ],
    memory: {
      writeCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
      appendTrace: (event) => traces.push(event),
    },
  })

  assert.equal(result.run.state, 'completed')
  assert.equal(result.plan.steps.length, 4)
  assert.match(result.output, /Offline agent result/)
  assert.equal(result.verification[0].ok, true)
  assert.equal(checkpoints.length, 1)
  assert.equal(checkpoints[0].runId, 'run_fake')
  assert.equal(traces.some((event) => event.type === 'provider_result'), true)
})

test('agent runtime can resume from checkpoint metadata', async () => {
  const plan = planAgentTask('Resume release')
  const resumed = await resumeAgentRun({
    checkpoint: {
      id: 'checkpoint_resume',
      runId: 'run_resume',
      objective: plan.objective,
      summary: 'previous summary',
    },
  })

  assert.equal(resumed.objective, 'Resume release')
  assert.equal(resumed.checkpoint.id, 'checkpoint_resume')
  assert.equal(resumed.summary, 'previous summary')
})

test('agent runtime runs configured verification commands through an injected runner', async () => {
  const seen = []
  const results = await runCommandVerifications(defaultVerificationCommands, {
    runner: async (spec) => {
      seen.push(spec.name)
      return {
        name: spec.name,
        ok: true,
        command: [spec.command, ...spec.args].join(' '),
        exitCode: 0,
        durationMs: 12,
        stdout: `${spec.name} ok`,
        detail: 'passed',
      }
    },
  })

  assert.deepEqual(seen, ['syntax', 'tests', 'pack-smoke'])
  assert.equal(results.length, 3)
  assert.equal(results.every((item) => item.ok), true)
  assert.match(results[0].command, /check:syntax/)
})

test('agent runtime assembles context, reads memory tiers, and routes MCP tools', async () => {
  const context = assembleAgentContext({
    git: { status: 'dirty', branch: 'main', dirty: true, changedFiles: 1, diffSummary: ['src/index.js | 2 +-'] },
    lsp: { status: 'available-for-project', detectedLanguages: ['javascript'] },
  })
  const memory = await readRuntimeMemory({
    readTier: async (tier) => ({ tier, ok: true }),
  }, ['project', 'task'])
  let run = createAgentRun({ objective: 'Use tool' })
  run = transitionAgentRun(run, 'loaded_context')
  run = transitionAgentRun(run, 'planned')
  run = transitionAgentRun(run, 'executing')
  const routed = await routeMcpToolCalls({
    run,
    registry: {
      echo: { risk: 'read', execute: (args) => args.text },
    },
    calls: [{ name: 'echo', args: { text: 'hello' } }],
  })

  assert.equal(context.git.protectedUserChanges, undefined)
  assert.equal(context.git.dirty, true)
  assert.equal(memory.project.ok, true)
  assert.equal(routed.results[0].output, 'hello')
  assert.equal(routed.run.events.at(-1).metadata.tool, 'echo')
  await assert.rejects(() => routeMcpToolCalls({
    registry: { write: { risk: 'filesystem', execute: () => 'done' } },
    calls: [{ name: 'write' }],
  }), SafetyGateError)
})

test('agent runtime detects destructive shell commands', () => {
  assert.equal(isDestructiveShellCommand('git reset --hard HEAD'), true)
  assert.equal(isDestructiveShellCommand('rm -rf dist'), true)
  assert.equal(isDestructiveShellCommand('npm test'), false)

  const result = evaluateSafetyGates({ commandsRun: ['git clean -fdx'] })
  assert.equal(result.ok, false)
  assert.equal(result.denied[0].gate, 'destructive-shell')
})

test('agent runtime detects secrets in trace output', () => {
  const result = evaluateSafetyGates({
    traceEvents: [{ type: 'provider_result', metadata: { text: 'Bearer sk_live_123456789abcdef' } }],
  })

  assert.equal(result.ok, false)
  assert.equal(result.denied[0].gate, 'secret-trace')
  assert.equal(result.denied[0].detail.matches[0], '[redacted]')
})

test('agent runtime requires confirmation for large edits, dirty Git, and high-risk MCP tools', () => {
  const result = evaluateSafetyGates({
    gitStatus: { dirty: true, changedFiles: 2, branch: 'main' },
    filesToEdit: [{ path: 'src/big.js', sizeBytes: 2 * 1024 * 1024 }],
    mcpTools: [{ name: 'filesystem.write', risk: 'filesystem' }],
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.confirmationsRequired.map((issue) => issue.gate), [
    'large-file-edit',
    'dirty-git-worktree',
    'high-risk-mcp-tool',
  ])
  assert.throws(() => assertSafetyGates({
    filesToEdit: [{ path: 'src/big.js', sizeBytes: 2 * 1024 * 1024 }],
  }), SafetyGateError)
})

test('agent runtime enforces safety gates before and during execution', async () => {
  await assert.rejects(
    () => runAgentTask({
      objective: 'Dangerous task',
      commandsRun: ['Remove-Item -Recurse -Force .'],
    }),
    (error) => {
      assert.equal(error instanceof SafetyGateError, true)
      assert.equal(error.issues[0].gate, 'destructive-shell')
      return true
    },
  )

  await assert.rejects(
    () => runAgentTask({
      objective: 'Secret task',
      provider: async () => 'token: sk_secret_123456789abcdef',
    }),
    (error) => {
      assert.equal(error instanceof SafetyGateError, true)
      assert.equal(error.issues[0].gate, 'secret-trace')
      return true
    },
  )
})

test('agent runtime includes memory tiers and MCP tool results in task runs', async () => {
  const result = await runAgentTask({
    objective: 'Use Aillive tool',
    memoryTiers: ['project'],
    memory: {
      readTier: async (tier) => ({ tier, content: 'memory' }),
    },
    toolRegistry: {
      echo: { risk: 'read', execute: (args) => `echo:${args.text}` },
    },
    mcpToolCalls: [{ name: 'echo', args: { text: 'ok' } }],
  })

  assert.equal(result.checkpoint.toolResults[0].output, 'echo:ok')
  assert.equal(result.run.events.some((event) => event.type === 'tool_call'), true)
})
