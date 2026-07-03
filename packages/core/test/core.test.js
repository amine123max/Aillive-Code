import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_BASE_URL,
  VERSION,
  authHeaders,
  maskSecret,
  normalizeBaseUrl,
  parseArgv,
  readJsonFile,
  resolveAillivePaths,
  safeParseJson,
  writeJsonFile,
} from '../src/index.js'

test('core exports stable version and URL constants', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
  assert.equal(DEFAULT_BASE_URL, 'https://www.aillive.xyz/api/v1')
})

test('core parses CLI argv options', () => {
  const parsed = parseArgv(['--json', 'chat', '--stream', '--model=qwen', 'hello'])
  assert.equal(parsed.command, 'chat')
  assert.equal(parsed.global.json, true)
  assert.equal(parsed.global.stream, true)
  assert.equal(parsed.global.model, 'qwen')
  assert.deepEqual(parsed.args, ['hello'])
})

test('core resolves Aillive paths from explicit home', () => {
  const paths = resolveAillivePaths('C:/tmp/aillive-home')
  assert.match(paths.configDir, /aillive-home$/)
  assert.equal(path.basename(paths.authFile), 'auth.json')
  assert.equal(path.basename(paths.sessionsFile), 'index.json')
})

test('core JSON helpers read fallback and write data', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-core-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'nested', 'data.json')
  assert.deepEqual(await readJsonFile(file, { ok: false }), { ok: false })
  await writeJsonFile(file, { ok: true })
  assert.deepEqual(await readJsonFile(file, {}), { ok: true })
})

test('core normalizes URLs, masks secrets, and builds auth headers', () => {
  assert.equal(normalizeBaseUrl('https://example.com/api/v1/'), 'https://example.com/api/v1')
  assert.equal(maskSecret('ail_1234567890abcdef'), 'ail_1234...abcdef')
  assert.equal(safeParseJson('{bad'), null)
  assert.equal(authHeaders('ail_test').authorization, 'Bearer ail_test')
  assert.throws(() => authHeaders(''), /Missing API key/)
})
