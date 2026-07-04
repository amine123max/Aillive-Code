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

const { COMMAND_MODULES, DEFAULT_BASE_URL, SLASH_COMMAND_GROUPS, VERSION, buildHelp, formatElapsed, generateCompletion, main, parseArgv, startCliAuthCallbackServer, wordmarkForWidth } = await import('../src/index.js')

async function captureMain(args) {
  const lines = []
  const oldLog = console.log
  const oldError = console.error
  const oldExitCode = process.exitCode
  process.exitCode = undefined
  console.log = (value = '') => lines.push(String(value))
  console.error = (value = '') => lines.push(String(value))
  try {
    await main(args)
  } finally {
    console.log = oldLog
    console.error = oldError
    process.exitCode = oldExitCode
  }
  return lines.join('\n')
}

async function captureMainRaw(args) {
  const chunks = []
  const oldLog = console.log
  const oldError = console.error
  const oldWrite = process.stdout.write
  const oldExitCode = process.exitCode
  process.exitCode = undefined
  console.log = (value = '') => chunks.push(`${String(value)}\n`)
  console.error = (value = '') => chunks.push(`${String(value)}\n`)
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString(encoding === 'buffer' ? undefined : encoding) : String(chunk))
    const cb = typeof encoding === 'function' ? encoding : callback
    if (typeof cb === 'function') cb()
    return true
  }
  try {
    await main(args)
  } finally {
    console.log = oldLog
    console.error = oldError
    process.stdout.write = oldWrite
    process.exitCode = oldExitCode
  }
  return chunks.join('')
}

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

test('auth browser callback writes auth.json under CLI home with animated auto-close page', async (t) => {
  await fs.rm(path.join(testHome, 'auth.json'), { force: true })
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-callback-project-'))
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }))

  const callback = await startCliAuthCallbackServer(
    { baseUrl: DEFAULT_BASE_URL, cwd: projectDir },
    { state: 'callback-state-test', timeoutMs: 5000 },
  )
  t.after(() => callback.close())

  const callbackUrl = new URL(callback.url)
  callbackUrl.searchParams.set('state', callback.state)
  callbackUrl.searchParams.set('apiKey', 'ail_callback_secret')
  callbackUrl.searchParams.set('baseUrl', 'https://example.com/api/v1')

  const response = await fetch(callbackUrl)
  const html = await response.text()
  const result = await callback.wait
  const authFile = path.join(testHome, 'auth.json')
  const auth = JSON.parse(await fs.readFile(authFile, 'utf8'))

  assert.equal(response.status, 200)
  assert.equal(result.path, authFile)
  assert.equal(auth.apiKey, 'ail_callback_secret')
  assert.equal(auth.baseUrl, 'https://example.com/api/v1')
  assert.equal(auth.source, 'browser callback')
  assert.match(html, /auth-dots/)
  assert.match(html, /window\.close\(\)/)
  await assert.rejects(() => fs.access(path.join(projectDir, 'auth.json')), { code: 'ENOENT' })
})

test('builds grouped help with project and completion commands', () => {
  const help = buildHelp(false)
  assert.match(help, /aillive context status/)
  assert.match(help, /aillive agent run/)
  assert.match(help, /aillive agent verify/)
  assert.match(help, /aillive home/)
  assert.match(help, /--project/)
  assert.match(help, /--offline/)
  assert.match(help, /--verify/)
  assert.match(help, /aillive completions powershell/)
  assert.equal(COMMAND_MODULES.some((item) => item.name === 'agent'), true)
  assert.equal(SLASH_COMMAND_GROUPS.some((group) => group.commands.some(([command]) => command === '/context on')), true)
})

test('help, version, status, config list, and context show stay scriptable', async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-scriptable-'))
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }))

  const help = await captureMain(['--help', '--no-color'])
  const version = await captureMain(['--version'])
  await captureMain(['config', 'set', 'model', 'mock-model'])
  const config = JSON.parse(await captureMain(['--json', 'config', 'list']))
  const status = JSON.parse(await captureMain(['--json', 'status', '--cwd', projectDir]))
  await captureMain(['init', '--cwd', projectDir])
  const context = await captureMain(['context', 'show', '--cwd', projectDir])

  assert.match(help, /Aillive CLI/)
  assert.equal(version.trim(), VERSION)
  assert.equal(config.model, 'mock-model')
  assert.equal(status.home, testHome)
  assert.equal(status.subsystems.provider.component, 'provider')
  assert.equal(status.subsystems.mcp.component, 'mcp')
  assert.equal(status.subsystems.lsp.component, 'lsp')
  assert.equal(status.subsystems.git.component, 'git')
  assert.equal(status.subsystems.memory.component, 'memory')
  assert.match(context, /Aillive Project Context/)
})

test('json errors use stable automation shape', async () => {
  const output = await captureMain(['--json', 'context', 'show', '--cwd', path.join(os.tmpdir(), 'aillive missing 中文 path')])
  const payload = JSON.parse(output)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'COMMAND_USAGE')
  assert.match(payload.error.message, /Project context not found/)
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

test('architecture status commands return stable json without external services', async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-arch-'))
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }))

  const commands = [
    ['runtime', 'status'],
    ['provider', 'status'],
    ['mcp', 'status'],
    ['mcp', 'list'],
    ['lsp', 'status'],
    ['git', 'status'],
    ['memory', 'status'],
  ]

  for (const command of commands) {
    const output = await captureMain(['--json', ...command, '--cwd', projectDir])
    const payload = JSON.parse(output)
    assert.equal(typeof payload.component, 'string')
    assert.equal(typeof payload.status, 'string')
  }
})

test('agent plan, run, and resume work offline with checkpoint memory', async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-agent-'))
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }))

  const planOutput = await captureMain(['--json', 'agent', 'plan', 'Prepare release notes', '--cwd', projectDir])
  const plan = JSON.parse(planOutput)
  assert.equal(plan.objective, 'Prepare release notes')
  assert.equal(plan.steps.length, 4)

  const runOutput = await captureMain(['--json', 'agent', 'run', 'Prepare release notes', '--cwd', projectDir])
  const run = JSON.parse(runOutput)
  assert.equal(run.run.state, 'completed')
  assert.match(run.output, /Offline agent result/)
  assert.equal(run.verification[0].ok, true)
  assert.equal(run.checkpoint.objective, 'Prepare release notes')

  const resumeOutput = await captureMain(['--json', 'agent', 'resume', run.checkpoint.id, '--cwd', projectDir])
  const resume = JSON.parse(resumeOutput)
  assert.equal(resume.checkpoint.id, run.checkpoint.id)
  assert.equal(resume.objective, 'Prepare release notes')
})

test('mcp call, git diff/checkpoint, and memory search are scriptable', async (t) => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-subsystems-'))
  t.after(() => fs.rm(projectDir, { recursive: true, force: true }))

  const mcp = JSON.parse(await captureMain(['--json', 'mcp', 'call', 'echo', '{"hello":"aillive"}', '--cwd', projectDir]))
  const gitDiff = JSON.parse(await captureMain(['--json', 'git', 'diff', '--summary', '--cwd', projectDir]))
  const gitCheckpoint = JSON.parse(await captureMain(['--json', 'git', 'checkpoint', '--cwd', projectDir]))
  await captureMain(['--json', 'agent', 'run', 'Searchable memory task', '--cwd', projectDir])
  const memory = JSON.parse(await captureMain(['--json', 'memory', 'search', 'Searchable', '--cwd', projectDir]))

  assert.equal(mcp.ok, true)
  assert.match(mcp.output, /aillive/)
  assert.equal(gitDiff.component, 'git')
  assert.equal(gitCheckpoint.component, 'git')
  assert.equal(memory.results.some((item) => item.tier === 'task'), true)
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

  const payload = JSON.parse(lines.join('\n'))
  assert.equal(requested, true)
  assert.equal(payload.data[0].id, 'mock-model')
  assert.equal(payload.data[0].label, 'Mock Model')
  assert.equal(payload.data[0].supports.streaming, true)
})

test('chat and streaming commands call API mocks', async (t) => {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    assert.equal(req.url, '/chat/completions')
    if (requests.length === 1) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: 'mock chat response' } }] }))
      return
    }
    res.setHeader('content-type', 'text/event-stream')
    res.end([
      'data: {"choices":[{"delta":{"content":"stream "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"response"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()

  const chat = JSON.parse(await captureMain(['--api-key', 'ail_test', '--base-url', `http://127.0.0.1:${port}`, '--json', 'chat', 'hello']))
  const stream = await captureMainRaw(['--api-key', 'ail_test', '--base-url', `http://127.0.0.1:${port}`, 'chat', '--stream', 'hello'])

  assert.equal(chat.choices[0].message.content, 'mock chat response')
  assert.match(stream, /stream response/)
  assert.equal(requests.length, 2)
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
