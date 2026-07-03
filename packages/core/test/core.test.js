import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_BASE_URL,
  VERSION,
  AilliveCliError,
  authHeaders,
  cliErrorCodes,
  colorize,
  createCliError,
  detectOutputMode,
  errorToJson,
  formatKeyValueRows,
  formatPanel,
  maskSecret,
  normalizeAuthPayload,
  normalizeBaseUrl,
  parseArgv,
  readJsonFile,
  resolveAillivePaths,
  safeParseJson,
  stripAnsi,
  writeJsonFile,
} from '../src/index.js'

test('core exports stable version and URL constants', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
  assert.equal(DEFAULT_BASE_URL, 'https://www.aillive.xyz/api/v1')
})

test('core parses CLI argv options', () => {
  const parsed = parseArgv(['--json', 'chat', '--stream', '--model=qwen', '--offline', '--trace', '--verify', 'hello'])
  assert.equal(parsed.command, 'chat')
  assert.equal(parsed.global.json, true)
  assert.equal(parsed.global.stream, true)
  assert.equal(parsed.global.model, 'qwen')
  assert.equal(parsed.global.offline, true)
  assert.equal(parsed.global.trace, true)
  assert.equal(parsed.global.verify, true)
  assert.deepEqual(parsed.args, ['hello'])
})

test('core resolves Aillive paths from explicit home', () => {
  const paths = resolveAillivePaths('C:/tmp/aillive-home')
  assert.match(paths.configDir, /aillive-home$/)
  assert.equal(path.basename(paths.authFile), 'auth.json')
  assert.equal(path.basename(paths.sessionsFile), 'index.json')

  const localized = resolveAillivePaths(path.join(os.tmpdir(), 'Aillive Home 中文'))
  assert.match(localized.configDir, /Aillive Home 中文$/)
  assert.equal(path.basename(localized.projectsDir), 'projects')
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

test('core exposes typed errors, output mode, formatting, ANSI, and auth normalization', () => {
  const error = createCliError(cliErrorCodes.AUTH_REQUIRED, 'login first', { detail: { command: 'chat' } })
  assert.equal(error instanceof AilliveCliError, true)
  assert.equal(errorToJson(error).error.code, 'AUTH_REQUIRED')
  assert.deepEqual(detectOutputMode({ json: true }, {}), { json: true, color: false })
  assert.equal(stripAnsi(colorize('OK', 32, true)), 'OK')
  assert.match(formatKeyValueRows([{ key: 'home', value: '~/.aillive' }]), /home/)
  assert.match(formatPanel('Title', ['body']), /\[Title\]/)
  assert.equal(normalizeAuthPayload({ token: 'ail_1234567890', baseUrl: 'https://example.com/' }).apiKey, 'ail_1234567890')
})
