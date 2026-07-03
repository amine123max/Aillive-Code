export const packageName = '@aillive/memory'
export const packageRole = 'Config, auth, session, stats, project context, checkpoint, and task trace stores.'

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
  const path = await import('node:path')
  const home = options.home || ''
  const sessionsFile = options.sessionsFile || (home ? path.join(home, 'sessions', 'index.json') : '')
  const statsFile = options.statsFile || (home ? path.join(home, 'stats.json') : '')
  const projectContextPath = options.projectContextPath || ''
  const checkpointsDir = home ? path.join(home, 'checkpoints') : ''
  const sessions = sessionsFile ? await readJson(sessionsFile, { sessions: [] }) : { sessions: [] }
  const stats = statsFile ? await readJson(statsFile, {}) : {}
  return {
    component: 'memory',
    package: packageName,
    status: home ? 'available' : 'unconfigured',
    home,
    stores: {
      auth: home ? await exists(path.join(home, 'auth.json')) : false,
      config: home ? await exists(path.join(home, 'config.json')) : false,
      stats: statsFile ? await exists(statsFile) : false,
      sessions: sessionsFile ? await exists(sessionsFile) : false,
      projectContext: projectContextPath ? await exists(projectContextPath) : false,
      checkpoints: checkpointsDir ? await exists(checkpointsDir) : false,
    },
    counts: {
      sessions: Array.isArray(sessions.sessions) ? sessions.sessions.length : 0,
      checkpoints: 0,
      commands: Number(stats.total || 0),
    },
    storageBytes: home ? await directorySize(home) : 0,
  }
}
