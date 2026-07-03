export const packageName = '@aillive/agent-runtime'
export const packageRole = 'Agent state machine, planning, context assembly, tool routing, verification, and checkpoints.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export const agentStates = [
  'created',
  'loaded_context',
  'planned',
  'executing',
  'waiting_for_permission',
  'verifying',
  'checkpointed',
  'completed',
  'failed',
  'interrupted',
]

export const agentTransitions = {
  created: ['loaded_context', 'failed', 'interrupted'],
  loaded_context: ['planned', 'failed', 'interrupted'],
  planned: ['executing', 'failed', 'interrupted'],
  executing: ['waiting_for_permission', 'verifying', 'failed', 'interrupted'],
  waiting_for_permission: ['executing', 'failed', 'interrupted'],
  verifying: ['checkpointed', 'completed', 'failed', 'interrupted'],
  checkpointed: ['executing', 'completed', 'failed', 'interrupted'],
  completed: [],
  failed: [],
  interrupted: ['loaded_context', 'failed'],
}

export const defaultVerificationCommands = [
  { name: 'syntax', command: 'npm', args: ['run', 'check:syntax'] },
  { name: 'tests', command: 'npm', args: ['test'] },
  { name: 'pack-smoke', command: 'npm', args: ['run', 'pack:smoke'] },
]

export const defaultSafetyPolicy = {
  destructiveShell: 'deny',
  secretTrace: 'deny',
  largeFileEdit: 'confirm',
  dirtyGitWorktree: 'confirm',
  highRiskMcpTool: 'confirm',
  maxFileBytes: 1024 * 1024,
}

export class SafetyGateError extends Error {
  constructor(message, issues = []) {
    super(message)
    this.name = 'SafetyGateError'
    this.issues = issues
    this.status = 1
  }
}

export function isValidAgentState(state) {
  return agentStates.includes(state)
}

export function isValidTransition(from, to) {
  return Boolean(agentTransitions[from]?.includes(to))
}

export function createAgentRun(options = {}) {
  const now = options.now || new Date().toISOString()
  return {
    id: options.id || `run_${Math.random().toString(36).slice(2, 10)}`,
    objective: String(options.objective || '').trim(),
    state: 'created',
    createdAt: now,
    updatedAt: now,
    events: [{
      type: 'state',
      state: 'created',
      at: now,
      metadata: options.metadata || {},
    }],
    checkpoints: [],
  }
}

export function transitionAgentRun(run, nextState, metadata = {}) {
  if (!isValidAgentState(nextState)) {
    throw new Error(`Unknown agent state: ${nextState}`)
  }
  if (!isValidTransition(run.state, nextState)) {
    throw new Error(`Invalid agent transition: ${run.state} -> ${nextState}`)
  }
  const at = metadata.at || new Date().toISOString()
  const next = {
    ...run,
    state: nextState,
    updatedAt: at,
    events: [
      ...(run.events || []),
      {
        type: 'state',
        from: run.state,
        state: nextState,
        at,
        metadata,
      },
    ],
  }
  if (nextState === 'checkpointed') {
    next.checkpoints = [
      ...(run.checkpoints || []),
      {
        id: metadata.checkpointId || `checkpoint_${(run.checkpoints || []).length + 1}`,
        at,
        files: metadata.files || [],
        summary: metadata.summary || '',
      },
    ]
  }
  return next
}

export function recordRuntimeEvent(run, type, metadata = {}) {
  const at = metadata.at || new Date().toISOString()
  return {
    ...run,
    updatedAt: at,
    events: [
      ...(run.events || []),
      { type, at, metadata },
    ],
  }
}

export function assertKnownTool(registry = {}, name = '') {
  if (!registry[name]) throw new Error(`Unknown tool: ${name}`)
  return registry[name]
}

export function assembleAgentContext(input = {}) {
  const git = input.git || {}
  const lsp = input.lsp || {}
  return {
    project: input.project || null,
    git: {
      status: git.status || 'unavailable',
      branch: git.branch || '',
      dirty: Boolean(git.dirty),
      changedFiles: git.changedFiles || 0,
      diffSummary: git.diffSummary || [],
    },
    lsp: {
      status: lsp.status || 'disabled',
      detectedLanguages: lsp.detectedLanguages || lsp.languages || [],
      diagnostics: lsp.diagnostics || null,
      workspace: lsp.workspace || null,
    },
    memory: input.memory || {},
  }
}

export async function readRuntimeMemory(memory = {}, tiers = []) {
  const requested = Array.isArray(tiers) ? tiers : [tiers]
  const result = {}
  for (const tier of requested.filter(Boolean)) {
    if (typeof memory.readTier === 'function') result[tier] = await memory.readTier(tier)
    else if (typeof memory.readMemoryTier === 'function') result[tier] = await memory.readMemoryTier(tier)
  }
  return result
}

export async function routeMcpToolCalls(options = {}) {
  const registry = options.registry || {}
  const calls = options.calls || []
  const safetyPolicy = normalizePolicy(options.safetyPolicy)
  let run = options.run
  const results = []
  for (const call of calls) {
    const name = call.name || call.tool || ''
    const definition = assertKnownTool(registry, name)
    const toolMeta = {
      name,
      risk: call.risk || definition.risk || 'read',
      highRisk: Boolean(call.highRisk || definition.highRisk || definition.destructive),
      confirmed: Boolean(call.confirmed),
    }
    assertSafetyGates({ mcpTools: [toolMeta] }, safetyPolicy)
    const execute = typeof definition === 'function' ? definition : (definition.execute || definition.call)
    if (typeof execute !== 'function') throw new Error(`MCP tool is not callable: ${name}`)
    const output = await execute(call.args || {}, call.context || {})
    const result = { name, ok: true, output }
    results.push(result)
    if (run) run = recordRuntimeEvent(run, 'tool_call', { tool: name, ok: true, output })
  }
  return { run, results }
}

function safetyIssue(gate, action, message, detail = {}) {
  return { gate, action, message, detail }
}

export function isDestructiveShellCommand(command = '') {
  const text = String(command || '').trim()
  const patterns = [
    /\brm\s+-[^\n;&|]*r[^\n;&|]*f\b/i,
    /\brm\s+-[^\n;&|]*f[^\n;&|]*r\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-[^\n;&|]*[fd][^\n;&|]*\b/i,
    /\bdel\s+\/[sq]\b/i,
    /\brmdir\s+\/s\b/i,
    /\bremove-item\b[^\n;&|]*-recurse\b[^\n;&|]*-force\b/i,
    /\bformat\b\s+[a-z]:/i,
    /\bdd\s+if=.+\s+of=.+/i,
  ]
  return patterns.some((pattern) => pattern.test(text))
}

export function findSecrets(value = '') {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {})
  const patterns = [
    /Bearer\s+[A-Za-z0-9._~+/_-]{12,}/gi,
    /\bail_[A-Za-z0-9._~+/-]{8,}/gi,
    /\b(?:api[_-]?key|token|secret|authorization)\b["'\s:=]+[A-Za-z0-9._~+/_-]{12,}/gi,
  ]
  const matches = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) matches.push(match[0])
  }
  return [...new Set(matches)]
}

function normalizePolicy(policy = {}) {
  return { ...defaultSafetyPolicy, ...policy }
}

export function evaluateSafetyGates(input = {}, policy = {}) {
  const activePolicy = normalizePolicy(policy)
  const issues = []
  const commands = input.commands || input.commandsRun || []
  for (const command of commands) {
    const text = typeof command === 'string' ? command : [command.command, ...(command.args || [])].filter(Boolean).join(' ')
    if (isDestructiveShellCommand(text)) {
      issues.push(safetyIssue(
        'destructive-shell',
        activePolicy.destructiveShell,
        `Destructive shell command blocked: ${text}`,
        { command: text },
      ))
    }
  }

  const traceValues = input.traceEvents || input.events || []
  const secrets = findSecrets(traceValues)
  if (secrets.length) {
    issues.push(safetyIssue(
      'secret-trace',
      activePolicy.secretTrace,
      'Trace output appears to contain a secret.',
      { matches: secrets.map(() => '[redacted]') },
    ))
  }

  const files = input.filesToEdit || input.filesTouched || []
  for (const file of files) {
    const size = Number(file.sizeBytes ?? file.bytes ?? file.content?.length ?? 0)
    if (size > activePolicy.maxFileBytes) {
      issues.push(safetyIssue(
        'large-file-edit',
        activePolicy.largeFileEdit,
        `Large file edit requires confirmation: ${file.path || file.file || '(unknown)'}`,
        { path: file.path || file.file || '', sizeBytes: size, maxFileBytes: activePolicy.maxFileBytes },
      ))
    }
  }

  const gitStatus = input.gitStatus || input.git
  if (gitStatus?.dirty && files.length) {
    issues.push(safetyIssue(
      'dirty-git-worktree',
      activePolicy.dirtyGitWorktree,
      'Dirty Git worktree requires confirmation before code edits.',
      { changedFiles: gitStatus.changedFiles || 0, branch: gitStatus.branch || '' },
    ))
  }

  const mcpTools = input.mcpTools || input.tools || []
  for (const tool of mcpTools) {
    const highRisk = tool.highRisk || tool.destructive || ['write', 'shell', 'filesystem', 'network'].includes(tool.risk)
    if (highRisk && !tool.confirmed) {
      issues.push(safetyIssue(
        'high-risk-mcp-tool',
        activePolicy.highRiskMcpTool,
        `High-risk MCP tool requires confirmation: ${tool.name || tool.id || '(unknown)'}`,
        { name: tool.name || tool.id || '', risk: tool.risk || '' },
      ))
    }
  }

  const blocking = issues.filter((issue) => ['deny', 'confirm'].includes(issue.action))
  return {
    ok: blocking.length === 0,
    issues,
    denied: issues.filter((issue) => issue.action === 'deny'),
    confirmationsRequired: issues.filter((issue) => issue.action === 'confirm'),
  }
}

export function assertSafetyGates(input = {}, policy = {}) {
  const result = evaluateSafetyGates(input, policy)
  if (!result.ok) {
    const denied = result.denied.length
    const confirmations = result.confirmationsRequired.length
    const label = denied ? 'SAFETY_DENIED' : 'SAFETY_CONFIRMATION_REQUIRED'
    throw new SafetyGateError(`${label}: ${denied} denied, ${confirmations} confirmation required.`, result.issues)
  }
  return result
}

export function planAgentTask(objective = '', options = {}) {
  const cleanObjective = String(objective || '').trim()
  const steps = Array.isArray(options.steps) && options.steps.length
    ? options.steps
    : [
      'Load available project, Git, LSP, MCP, and memory context.',
      'Ask the provider or fake provider for a concise execution result.',
      'Run configured verification hooks and record evidence.',
      'Write checkpoint and trace events for resume.',
    ]
  return {
    objective: cleanObjective,
    mode: options.mode || 'agent',
    permissions: {
      tools: options.tools || 'disabled-by-default',
      write: options.write || 'checkpoint-only',
      network: options.network || 'provider-only',
    },
    steps: steps.map((step, index) => ({
      id: `step_${index + 1}`,
      title: String(step),
      status: 'pending',
    })),
  }
}

function fakeProviderResponse(objective, context = {}) {
  const contextParts = []
  if (context.project?.content) contextParts.push('project')
  if (context.git?.branch) contextParts.push(`git:${context.git.branch}`)
  if (context.lsp?.detectedLanguages?.length) contextParts.push(`lsp:${context.lsp.detectedLanguages.join(',')}`)
  const suffix = contextParts.length ? ` Context: ${contextParts.join(' | ')}.` : ''
  return `Offline agent result for: ${objective}.${suffix}`
}

async function runVerificationHooks(hooks = [], run) {
  const results = []
  for (const hook of hooks) {
    const result = typeof hook === 'function' ? await hook(run) : hook
    results.push({
      name: result?.name || 'verification',
      ok: Boolean(result?.ok),
      command: result?.command || '',
      exitCode: Number(result?.exitCode || 0),
      durationMs: Number(result?.durationMs || 0),
      stdout: tail(result?.stdout),
      stderr: tail(result?.stderr),
      detail: result?.detail || '',
    })
  }
  if (!results.length) {
    results.push({ name: 'offline-smoke', ok: true, detail: 'No verification hooks configured.' })
  }
  return results
}

function tail(text = '', maxChars = 1200) {
  const value = String(text || '').trim()
  return value.length > maxChars ? value.slice(-maxChars) : value
}

async function defaultCommandRunner(spec, options = {}) {
  const { execFile } = await import('node:child_process')
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const started = Date.now()
  let command = spec.command
  let args = spec.args || []
  if (spec.command === 'npm') {
    const candidates = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ].filter(Boolean)
    for (const candidate of candidates) {
      try {
        await fs.access(candidate)
        command = process.execPath
        args = [candidate, ...(spec.args || [])]
        break
      } catch {}
    }
  }
  const displayCommand = [spec.command, ...(spec.args || [])].join(' ')
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      windowsHide: true,
      timeout: options.timeoutMs || spec.timeoutMs || 120000,
      maxBuffer: options.maxBuffer || 1024 * 1024 * 8,
    })
    return {
      name: spec.name,
      ok: true,
      command: displayCommand,
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: tail(result.stdout),
      stderr: tail(result.stderr),
      detail: 'passed',
    }
  } catch (error) {
    return {
      name: spec.name,
      ok: false,
      command: displayCommand,
      exitCode: Number(error.code || error.exitCode || 1),
      durationMs: Date.now() - started,
      stdout: tail(error.stdout),
      stderr: tail(error.stderr),
      detail: error.message,
    }
  }
}

export async function runCommandVerifications(commands = defaultVerificationCommands, options = {}) {
  const runner = options.runner || ((spec) => defaultCommandRunner(spec, options))
  const results = []
  for (const spec of commands) {
    results.push(await runner(spec, options))
  }
  return results.map((result) => ({
    name: result.name || 'verification',
    ok: Boolean(result.ok),
    command: result.command || '',
    exitCode: Number(result.exitCode || 0),
    durationMs: Number(result.durationMs || 0),
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    detail: result.detail || (result.ok ? 'passed' : 'failed'),
  }))
}

export async function runAgentTask(options = {}) {
  const objective = String(options.objective || '').trim()
  if (!objective) throw new Error('Agent objective is required.')
  const memory = options.memory || {}
  const memoryContext = await readRuntimeMemory(memory, options.memoryTiers || [])
  const context = assembleAgentContext({ ...(options.context || {}), memory: memoryContext })
  const safetyPolicy = normalizePolicy(options.safetyPolicy)
  let run = createAgentRun({
    id: options.id,
    objective,
    metadata: { mode: options.mode || 'agent', offline: options.offline !== false },
  })
  run = transitionAgentRun(run, 'loaded_context', {
    project: Boolean(context.project?.content),
    git: context.git?.status || '',
    lsp: context.lsp?.status || '',
  })
  const plan = planAgentTask(objective, options.plan || {})
  run = transitionAgentRun(run, 'planned', { steps: plan.steps.length, plan })
  assertSafetyGates({
    commandsRun: options.commandsRun || [],
    filesToEdit: options.filesToEdit || options.filesTouched || [],
    gitStatus: context.git,
    mcpTools: options.mcpTools || [],
    traceEvents: run.events,
  }, safetyPolicy)
  run = transitionAgentRun(run, 'executing', { provider: options.provider ? 'custom' : 'fake' })
  const toolRouting = await routeMcpToolCalls({
    run,
    registry: options.toolRegistry || {},
    calls: options.mcpToolCalls || [],
    safetyPolicy,
  })
  run = toolRouting.run || run
  const provider = options.provider || (async () => fakeProviderResponse(objective, context))
  const output = await provider({ objective, context, plan, run, toolResults: toolRouting.results })
  run = recordRuntimeEvent(run, 'provider_result', { output })
  assertSafetyGates({ traceEvents: run.events }, safetyPolicy)
  run = transitionAgentRun(run, 'verifying', {})
  const verification = await runVerificationHooks(options.verificationHooks, run)
  run = recordRuntimeEvent(run, 'verification', { verification })
  assertSafetyGates({ traceEvents: run.events }, safetyPolicy)
  const checkpointId = options.checkpointId || `checkpoint_${run.id}`
  run = transitionAgentRun(run, 'checkpointed', {
    checkpointId,
    summary: output,
    files: options.filesTouched || [],
    verification,
  })
  run = transitionAgentRun(run, 'completed', { ok: verification.every((item) => item.ok) })
  const checkpoint = {
    id: checkpointId,
    runId: run.id,
    objective,
    state: run.state,
    summary: output,
    plan: plan.steps,
    filesTouched: options.filesTouched || [],
    commandsRun: options.commandsRun || [],
    failures: verification.filter((item) => !item.ok),
    fixes: [],
    verification,
    events: run.events,
    toolResults: toolRouting.results,
  }
  if (typeof memory.writeCheckpoint === 'function') await memory.writeCheckpoint(checkpoint)
  if (typeof memory.appendTrace === 'function') {
    for (const event of run.events) await memory.appendTrace({ ...event, runId: run.id })
  }
  return { run, plan, output, verification, checkpoint }
}

export async function resumeAgentRun(options = {}) {
  const memory = options.memory || {}
  const checkpoint = options.checkpoint || (typeof memory.readCheckpoint === 'function'
    ? await memory.readCheckpoint(options.id || 'latest')
    : null)
  if (!checkpoint) throw new Error('Checkpoint not found.')
  return {
    objective: checkpoint.objective || '',
    checkpoint,
    summary: checkpoint.summary || '',
    next: 'Run `aillive agent run` with the same objective to continue from this checkpoint.',
  }
}

export function getRuntimeStatus(options = {}) {
  const subsystems = options.subsystems || []
  const unavailable = subsystems.filter((item) => ['disabled', 'unavailable', 'not-a-repository'].includes(item.status))
  return {
    component: 'runtime',
    package: packageName,
    status: 'active',
    stateMachine: agentStates,
    transitions: agentTransitions,
    subsystems,
    readyForAgentRun: unavailable.length === 0,
    unavailable: unavailable.map((item) => item.component),
  }
}
