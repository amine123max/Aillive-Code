import path from 'node:path'

export const packageName = '@aillive/memory'
export const packageRole = 'Config, auth, session, stats, project context, checkpoint, and task trace stores.'
export const memoryTiers = ['global', 'project', 'session', 'task']

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export async function readProjectContext(options = {}) {
  const fs = await import('node:fs/promises')
  const file = options.path || ''
  const legacyFile = options.legacyPath || ''
  const maxChars = Number(options.maxChars || 12000)
  if (!options.enabled) return { path: file, legacyPath: legacyFile, exists: false, content: '', source: 'global' }
  try {
    const raw = await fs.readFile(file, 'utf8')
    const content = raw.trim().slice(0, maxChars)
    return { path: file, legacyPath: legacyFile, exists: true, content, source: 'global' }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const raw = await fs.readFile(legacyFile, 'utf8')
    const content = raw.trim().slice(0, maxChars)
    return { path: legacyFile, legacyPath: legacyFile, preferredPath: file, exists: true, content, source: 'legacy' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: file, legacyPath: legacyFile, exists: false, content: '', source: 'global' }
    throw error
  }
}

export async function readSessions(sessionsFile) {
  return readJson(sessionsFile, { sessions: [] })
}

export async function writeSessions(sessionsFile, sessions) {
  await writeJson(sessionsFile, { sessions })
}

export async function recordSession(sessionsFile, type, prompt, content, limit = 50) {
  const data = await readSessions(sessionsFile)
  data.sessions.unshift({
    id: `ses_${Date.now().toString(36)}`,
    type,
    prompt,
    content,
    createdAt: new Date().toISOString(),
  })
  data.sessions = data.sessions.slice(0, limit)
  await writeJson(sessionsFile, data)
  return data
}

export async function readStats(statsFile) {
  return readJson(statsFile, { total: 0, ok: 0, failed: 0, commands: {}, lastUsedAt: '' })
}

export async function recordStats(statsFile, command, latencyMs, ok) {
  const data = await readStats(statsFile)
  data.total += 1
  data[ok ? 'ok' : 'failed'] += 1
  data.lastUsedAt = new Date().toISOString()
  data.commands[command] = data.commands[command] || { total: 0, ok: 0, failed: 0, latencyMs: 0 }
  data.commands[command].total += 1
  data.commands[command][ok ? 'ok' : 'failed'] += 1
  data.commands[command].latencyMs += Number(latencyMs || 0)
  await writeJson(statsFile, data)
  return data
}

export function resolveMemoryFiles(home = '') {
  return {
    configFile: home ? path.join(home, 'config.json') : '',
    authFile: home ? path.join(home, 'auth.json') : '',
    statsFile: home ? path.join(home, 'stats.json') : '',
    sessionsFile: home ? path.join(home, 'sessions', 'index.json') : '',
    checkpointsFile: home ? path.join(home, 'checkpoints', 'index.json') : '',
    tracesFile: home ? path.join(home, 'traces', 'index.json') : '',
  }
}

export async function readConfigStore(configFile) {
  return readJson(configFile, {})
}

export async function writeConfigStore(configFile, config) {
  await writeJson(configFile, config)
  return config
}

export async function readAuthStore(authFile) {
  return readJson(authFile, {})
}

export async function writeAuthStore(authFile, auth) {
  await writeJson(authFile, auth)
  return auth
}

export async function readCheckpoints(checkpointsFile) {
  return readJson(checkpointsFile, { checkpoints: [] })
}

export async function writeCheckpoint(checkpointsFile, checkpoint, limit = 100) {
  const data = await readCheckpoints(checkpointsFile)
  const record = {
    id: checkpoint.id || `checkpoint_${Date.now().toString(36)}`,
    runId: checkpoint.runId || '',
    objective: checkpoint.objective || '',
    state: checkpoint.state || '',
    summary: checkpoint.summary || '',
    plan: checkpoint.plan || [],
    filesTouched: checkpoint.filesTouched || checkpoint.files || [],
    commandsRun: checkpoint.commandsRun || [],
    failures: checkpoint.failures || [],
    fixes: checkpoint.fixes || [],
    verification: checkpoint.verification || [],
    events: checkpoint.events || [],
    createdAt: checkpoint.createdAt || new Date().toISOString(),
  }
  data.checkpoints.unshift(record)
  data.checkpoints = data.checkpoints.slice(0, limit)
  await writeJson(checkpointsFile, data)
  return record
}

export async function readCheckpoint(checkpointsFile, id = 'latest') {
  const data = await readCheckpoints(checkpointsFile)
  if (id === 'latest') return data.checkpoints[0] || null
  return data.checkpoints.find((checkpoint) => checkpoint.id === id || checkpoint.runId === id) || null
}

export async function readTaskTraces(tracesFile) {
  return readJson(tracesFile, { traces: [] })
}

export async function appendTaskTrace(tracesFile, event, limit = 500) {
  const data = await readTaskTraces(tracesFile)
  const record = {
    id: event.id || `trace_${Date.now().toString(36)}`,
    runId: event.runId || '',
    type: event.type || 'event',
    at: event.at || new Date().toISOString(),
    metadata: event.metadata || {},
  }
  data.traces.unshift(record)
  data.traces = data.traces.slice(0, limit)
  await writeJson(tracesFile, data)
  return record
}

export async function readMemoryTier(tier, options = {}) {
  const files = resolveMemoryFiles(options.home || '')
  if (tier === 'global') {
    return {
      tier,
      config: await readConfigStore(options.configFile || files.configFile),
      auth: await readAuthStore(options.authFile || files.authFile),
      stats: await readStats(options.statsFile || files.statsFile),
    }
  }
  if (tier === 'project') {
    return {
      tier,
      context: await readProjectContext({
        enabled: true,
        path: options.projectContextPath || '',
        legacyPath: options.legacyProjectContextPath || '',
        maxChars: options.maxChars,
      }),
    }
  }
  if (tier === 'session') {
    return {
      tier,
      sessions: await readSessions(options.sessionsFile || files.sessionsFile),
    }
  }
  if (tier === 'task') {
    return {
      tier,
      checkpoints: await readCheckpoints(options.checkpointsFile || files.checkpointsFile),
      traces: await readTaskTraces(options.tracesFile || files.tracesFile),
    }
  }
  throw new Error(`Unknown memory tier: ${tier}`)
}

export async function searchMemory(query = '', options = {}) {
  const needle = String(query || '').toLowerCase()
  if (!needle) return []
  const results = []
  const home = options.home || ''
  const files = resolveMemoryFiles(home)
  const sessions = await readSessions(options.sessionsFile || files.sessionsFile)
  const checkpoints = await readCheckpoints(options.checkpointsFile || files.checkpointsFile)
  const traces = await readTaskTraces(options.tracesFile || files.tracesFile)
  const project = options.projectContextPath
    ? await readProjectContext({ enabled: true, path: options.projectContextPath, legacyPath: options.legacyProjectContextPath || '' })
    : null
  for (const session of sessions.sessions || []) {
    const haystack = `${session.prompt || ''}\n${session.content || ''}`.toLowerCase()
    if (haystack.includes(needle)) results.push({ tier: 'session', id: session.id, text: session.prompt || session.content || '' })
  }
  for (const checkpoint of checkpoints.checkpoints || []) {
    const haystack = `${checkpoint.objective || ''}\n${checkpoint.summary || ''}`.toLowerCase()
    if (haystack.includes(needle)) results.push({ tier: 'task', id: checkpoint.id, text: checkpoint.objective || checkpoint.summary || '' })
  }
  for (const trace of traces.traces || []) {
    const haystack = JSON.stringify(trace).toLowerCase()
    if (haystack.includes(needle)) results.push({ tier: 'task', id: trace.id, text: trace.type || 'trace' })
  }
  if (project?.content?.toLowerCase().includes(needle)) {
    results.push({ tier: 'project', id: project.path, text: project.content.slice(0, 200) })
  }
  return results.slice(0, options.limit || 20)
}

async function exists(file) {
  const fs = await import('node:fs/promises')
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function readJson(file, fallback) {
  const fs = await import('node:fs/promises')
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(file, data, mode = 0o600) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode })
  if (process.platform !== 'win32') await fs.chmod(file, mode)
}

async function directorySize(dir) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  let total = 0
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(fullPath)
    else {
      const stat = await fs.stat(fullPath).catch(() => null)
      total += stat?.size || 0
    }
  }
  return total
}

export async function getMemoryStatus(options = {}) {
  const home = options.home || ''
  const sessionsFile = options.sessionsFile || (home ? path.join(home, 'sessions', 'index.json') : '')
  const statsFile = options.statsFile || (home ? path.join(home, 'stats.json') : '')
  const checkpointsFile = options.checkpointsFile || (home ? path.join(home, 'checkpoints', 'index.json') : '')
  const tracesFile = options.tracesFile || (home ? path.join(home, 'traces', 'index.json') : '')
  const projectContextPath = options.projectContextPath || ''
  const checkpointsDir = home ? path.join(home, 'checkpoints') : ''
  const sessions = sessionsFile ? await readJson(sessionsFile, { sessions: [] }) : { sessions: [] }
  const stats = statsFile ? await readJson(statsFile, {}) : {}
  const checkpoints = checkpointsFile ? await readJson(checkpointsFile, { checkpoints: [] }) : { checkpoints: [] }
  const traces = tracesFile ? await readJson(tracesFile, { traces: [] }) : { traces: [] }
  return {
    component: 'memory',
    package: packageName,
    status: home ? 'available' : 'unconfigured',
    home,
    projectContextPath,
    stores: {
      auth: home ? await exists(path.join(home, 'auth.json')) : false,
      config: home ? await exists(path.join(home, 'config.json')) : false,
      stats: statsFile ? await exists(statsFile) : false,
      sessions: sessionsFile ? await exists(sessionsFile) : false,
      projectContext: projectContextPath ? await exists(projectContextPath) : false,
      checkpoints: checkpointsDir ? await exists(checkpointsDir) : false,
      traces: tracesFile ? await exists(tracesFile) : false,
    },
    tiers: memoryTiers,
    counts: {
      sessions: Array.isArray(sessions.sessions) ? sessions.sessions.length : 0,
      checkpoints: Array.isArray(checkpoints.checkpoints) ? checkpoints.checkpoints.length : 0,
      traces: Array.isArray(traces.traces) ? traces.traces.length : 0,
      commands: Number(stats.total || 0),
    },
    storageBytes: home ? await directorySize(home) : 0,
  }
}
