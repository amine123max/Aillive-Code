import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readProjectContext,
  readSessions,
  readStats,
  recordSession,
  recordStats,
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
