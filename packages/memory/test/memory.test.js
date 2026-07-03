import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendTaskTrace,
  getMemoryStatus,
  memoryTiers,
  readAuthStore,
  readCheckpoint,
  readCheckpoints,
  readConfigStore,
  readMemoryTier,
  readProjectContext,
  readSessions,
  readStats,
  readTaskTraces,
  recordSession,
  recordStats,
  resolveMemoryFiles,
  searchMemory,
  writeAuthStore,
  writeCheckpoint,
  writeConfigStore,
  writeSessions,
} from '../src/index.js'

test('memory reads and writes sessions', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-memory-sessions-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const sessionsFile = path.join(dir, 'sessions', 'index.json')
  assert.deepEqual(await readSessions(sessionsFile), { sessions: [] })
  await recordSession(sessionsFile, 'chat', 'hello', 'world')
  const data = await readSessions(sessionsFile)
  assert.equal(data.sessions.length, 1)
  assert.equal(data.sessions[0].prompt, 'hello')
  await writeSessions(sessionsFile, [])
  assert.deepEqual(await readSessions(sessionsFile), { sessions: [] })
})

test('memory records command stats', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-memory-stats-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const statsFile = path.join(dir, 'stats.json')
  await recordStats(statsFile, 'chat', 42, true)
  const stats = await readStats(statsFile)
  assert.equal(stats.total, 1)
  assert.equal(stats.ok, 1)
  assert.equal(stats.commands.chat.latencyMs, 42)
})

test('memory reads project context with legacy fallback', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-memory-context-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const preferred = path.join(dir, 'global', 'project.md')
  const legacy = path.join(dir, '.aillive', 'project.md')
  await fs.mkdir(path.dirname(legacy), { recursive: true })
  await fs.writeFile(legacy, 'legacy context', 'utf8')
  const disabled = await readProjectContext({ enabled: false, path: preferred, legacyPath: legacy })
  assert.equal(disabled.exists, false)
  const context = await readProjectContext({ enabled: true, path: preferred, legacyPath: legacy })
  assert.equal(context.exists, true)
  assert.equal(context.source, 'legacy')
  assert.equal(context.content, 'legacy context')
})

test('memory stores task checkpoints and trace events', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-memory-task-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const { checkpointsFile, tracesFile } = resolveMemoryFiles(dir)

  assert.deepEqual(memoryTiers, ['global', 'project', 'session', 'task'])
  const checkpoint = await writeCheckpoint(checkpointsFile, {
    id: 'checkpoint_1',
    runId: 'run_1',
    objective: 'ship release',
    state: 'completed',
    summary: 'done',
    plan: [{ id: 'step_1', title: 'Check release', status: 'done' }],
    filesTouched: ['task.md'],
    commandsRun: ['npm test'],
    verification: [{ name: 'tests', ok: true }],
  })
  await appendTaskTrace(tracesFile, {
    runId: 'run_1',
    type: 'verification',
    metadata: { ok: true },
  })

  const checkpoints = await readCheckpoints(checkpointsFile)
  const latest = await readCheckpoint(checkpointsFile, 'latest')
  const trace = await readTaskTraces(tracesFile)

  assert.equal(checkpoint.id, 'checkpoint_1')
  assert.equal(checkpoints.checkpoints.length, 1)
  assert.equal(latest.objective, 'ship release')
  assert.equal(trace.traces.length, 1)
  assert.equal(trace.traces[0].metadata.ok, true)

  const status = await getMemoryStatus({
    home: dir,
    checkpointsFile,
    tracesFile,
  })
  assert.equal(status.counts.checkpoints, 1)
  assert.equal(status.counts.traces, 1)
  assert.equal(status.tiers.includes('task'), true)
})

test('memory supports config/auth stores, tier reads, and local search', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-memory-tier-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const files = resolveMemoryFiles(dir)
  const projectFile = path.join(dir, 'projects', 'project.md')
  await fs.mkdir(path.dirname(projectFile), { recursive: true })

  await writeConfigStore(files.configFile, { model: 'mock-model' })
  await writeAuthStore(files.authFile, { apiKey: 'ail_secret' })
  await recordSession(files.sessionsFile, 'chat', 'release checklist', 'done')
  await writeCheckpoint(files.checkpointsFile, { id: 'checkpoint_search', objective: 'release task', summary: 'verified release' })
  await fs.writeFile(projectFile, 'release project context', 'utf8')

  const globalTier = await readMemoryTier('global', { home: dir })
  const sessionTier = await readMemoryTier('session', { home: dir })
  const taskTier = await readMemoryTier('task', { home: dir })
  const results = await searchMemory('release', { home: dir, projectContextPath: projectFile })

  assert.equal((await readConfigStore(files.configFile)).model, 'mock-model')
  assert.equal((await readAuthStore(files.authFile)).apiKey, 'ail_secret')
  assert.equal(globalTier.config.model, 'mock-model')
  assert.equal(sessionTier.sessions.sessions.length, 1)
  assert.equal(taskTier.checkpoints.checkpoints[0].id, 'checkpoint_search')
  assert.equal(results.some((item) => item.tier === 'project'), true)
  assert.equal(results.some((item) => item.tier === 'task'), true)
})
