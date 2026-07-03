import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

process.env.AILLIVE_CLI_IMPORT_ONLY = '1'
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-home-'))
process.env.AILLIVE_HOME = testHome
test.after(() => fs.rm(testHome, { recursive: true, force: true }))

const { DEFAULT_BASE_URL, VERSION, buildHelp, formatElapsed, generateCompletion, main, parseArgv, wordmarkForWidth } = await import('../src/index.js')

test('exports version and default base url', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/)
  assert.equal(DEFAULT_BASE_URL, 'https://www.aillive.xyz/api/v1')
})

test('parses global options before command', () => {
  const parsed = parseArgv(['--json', '--base-url', 'http://127.0.0.1:3001/api/v1', 'chat', 'hello'])
  assert.equal(parsed.command, 'chat')
  assert.equal(parsed.global.json, true)
  assert.equal(parsed.global.baseUrl, 'http://127.0.0.1:3001/api/v1')
  assert.deepEqual(parsed.args, ['hello'])
})

test('parses stream and model options', () => {
  const parsed = parseArgv(['chat', '--stream', '--model=qwen2.5:0.5b', 'hi'])
  assert.equal(parsed.command, 'chat')
  assert.equal(parsed.global.stream, true)
  assert.equal(parsed.global.model, 'qwen2.5:0.5b')
  assert.deepEqual(parsed.args, ['hi'])
})

test('parses usage date filters', () => {
  const parsed = parseArgv(['usage', '--from', '2026-07-01', '--to=2026-07-31'])
  assert.equal(parsed.command, 'usage')
  assert.equal(parsed.global.from, '2026-07-01')
  assert.equal(parsed.global.to, '2026-07-31')
})

test('parses open flag for local home commands', () => {
  const parsed = parseArgv(['home', '--open'])
  assert.equal(parsed.command, 'home')
  assert.equal(parsed.global.open, true)
})

test('parses project context and system options', () => {
  const parsed = parseArgv(['run', '--project', '--system', 'Be brief', '--cwd', 'C:/tmp/app', 'summarize'])
  assert.equal(parsed.command, 'run')
  assert.equal(parsed.global.project, true)
  assert.equal(parsed.global.system, 'Be brief')
  assert.equal(parsed.global.cwd, 'C:/tmp/app')
  assert.deepEqual(parsed.args, ['summarize'])
})

test('parses data dir for admin commands', () => {
  const parsed = parseArgv(['admin', 'promote', 'admin@example.com', '--data-dir', 'C:/tmp/aillive-data'])
  assert.equal(parsed.command, 'admin')
  assert.equal(parsed.subcommand, 'promote')
  assert.equal(parsed.global.dataDir, 'C:/tmp/aillive-data')
  assert.deepEqual(parsed.rest, ['admin@example.com'])
})

test('context path is stored under the user .aillive directory', async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-project-'))
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }))
  const lines = []
  const oldLog = console.log
  const oldError = console.error
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(['context', 'path', '--cwd', projectDir])
  } finally {
    console.log = oldLog
    console.error = oldError
  }
  const output = lines.join('\n')
  assert.match(output, new RegExp(`aillive-cli-home-.*\\${path.sep === '\\' ? '\\\\' : '/'}projects`))
  assert.match(output, /project\.md$/)
  assert.equal(output.includes(projectDir), false)
})

test('home command reports the CLI user directory', async () => {
  const lines = []
  const oldLog = console.log
  const oldError = console.error
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(['--json', 'home'])
  } finally {
    console.log = oldLog
    console.error = oldError
  }
  const payload = JSON.parse(lines.join('\n'))
  assert.equal(payload.home, testHome)
  assert.equal(payload.authFile, path.join(testHome, 'auth.json'))
  assert.equal(payload.configFile, path.join(testHome, 'config.json'))
  assert.equal(payload.files.projects, true)
  assert.equal(payload.files.sessions, true)
})

test('config set api-key writes auth.json instead of config apiKey', async () => {
  await fs.rm(path.join(testHome, 'auth.json'), { force: true })
  await fs.rm(path.join(testHome, 'config.json'), { force: true })
  const lines = []
  const oldLog = console.log
  const oldError = console.error
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(['config', 'set', 'api-key', 'ail_test_secret'])
  } finally {
    console.log = oldLog
    console.error = oldError
  }

  const auth = JSON.parse(await fs.readFile(path.join(testHome, 'auth.json'), 'utf8'))
  const config = await fs.readFile(path.join(testHome, 'config.json'), 'utf8').then(JSON.parse).catch(() => ({}))
  assert.equal(auth.apiKey, 'ail_test_secret')
  assert.equal(auth.type, 'aillive_cli_auth')
  assert.equal(config.apiKey, undefined)
})

test('builds grouped help with project and completion commands', () => {
  const help = buildHelp(false)
  assert.match(help, /aillive context status/)
  assert.match(help, /aillive home/)
  assert.match(help, /--project/)
  assert.match(help, /aillive completions powershell/)
})

test('formats working elapsed time from real milliseconds', () => {
  assert.equal(formatElapsed(0), '0.0s')
  assert.equal(formatElapsed(1250), '1.2s')
  assert.equal(formatElapsed(10000), '10s')
  assert.equal(formatElapsed(61000), '1m01s')
})

test('uses compact wordmark when terminal width is narrow', () => {
  const narrow = wordmarkForWidth(40)
  assert.deepEqual(narrow, ['AILLIVE'])

  const compact = wordmarkForWidth(58)
  assert.notDeepEqual(compact, ['AILLIVE'])
  assert.equal(Math.max(...compact.map((line) => line.length)) <= 58, true)
})

test('generates shell completions', () => {
  assert.match(generateCompletion('powershell'), /Register-ArgumentCompleter/)
  assert.match(generateCompletion('bash'), /complete -F _aillive_complete aillive/)
  assert.match(generateCompletion('zsh'), /#compdef aillive/)
})

test('models command calls an API mock', async (t) => {
  let requested = false
  const server = http.createServer((req, res) => {
    requested = true
    assert.equal(req.url, '/models')
    assert.equal(req.headers.authorization, 'Bearer ail_test')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', label: 'Mock Model', owned_by: 'aillive' }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  const { port } = server.address()
  const lines = []
  const oldLog = console.log
  const oldError = console.error
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(['--api-key', 'ail_test', '--base-url', `http://127.0.0.1:${port}`, '--json', 'models'])
  } finally {
    console.log = oldLog
    console.error = oldError
  }

  assert.equal(requested, true)
  assert.match(lines.join('\n'), /mock-model/)
})

test('admin promote updates a local store and creates a backup', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-admin-'))
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }))
  const storePath = path.join(dataDir, 'store.json')
  await fs.writeFile(storePath, JSON.stringify({
    users: [{
      id: 'user_1',
      email: 'admin@example.com',
      role: 'user',
      status: 'active',
    }],
    verificationCodes: [],
    sessions: [],
    apiKeys: [],
    automationTasks: [],
  }, null, 2), 'utf8')

  const lines = []
  const oldLog = console.log
  const oldError = console.error
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(['--json', 'admin', 'promote', 'Admin@Example.com', '--data-dir', dataDir])
  } finally {
    console.log = oldLog
    console.error = oldError
  }

  const result = JSON.parse(lines.join('\n'))
  const nextStore = JSON.parse(await fs.readFile(storePath, 'utf8'))
  const backups = (await fs.readdir(dataDir)).filter((name) => name.startsWith('store.json.backup-'))
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(nextStore.users[0].role, 'admin')
  assert.equal(backups.length, 1)
})

test('admin promote writes audit log when sqlite audit table exists', async (t) => {
  let sqlite
  try {
    sqlite = await import('node:sqlite')
  } catch {
    return
  }
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-admin-audit-'))
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }))
  const storePath = path.join(dataDir, 'store.json')
  await fs.writeFile(storePath, JSON.stringify({
    users: [{
      id: 'user_2',
      email: 'owner@example.com',
      role: 'user',
      status: 'active',
    }],
    verificationCodes: [],
    sessions: [],
    apiKeys: [],
    automationTasks: [],
  }, null, 2), 'utf8')
  const db = new sqlite.DatabaseSync(path.join(dataDir, 'aillive.sqlite'))
  db.exec(`
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      actor_user_id TEXT NOT NULL DEFAULT '',
      actor_type TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `)

  const lines = []
  const oldLog = console.log
  const oldError = console.error
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(['--json', 'admin', 'promote', 'owner@example.com', '--data-dir', dataDir])
  } finally {
    console.log = oldLog
    console.error = oldError
  }

  const row = db.prepare('SELECT action, actor_type, target_id FROM audit_logs').get()
  db.close()
  const result = JSON.parse(lines.join('\n'))
  assert.equal(result.audit.written, true)
  assert.equal(row.action, 'admin.user.promoted')
  assert.equal(row.actor_type, 'cli')
  assert.equal(row.target_id, 'user_2')
})
