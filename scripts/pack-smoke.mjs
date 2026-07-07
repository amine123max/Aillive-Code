import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const expectedTarballFiles = [
  'LICENSE',
  'README.md',
  'README.zh.md',
  'apps/cli/package.json',
  'apps/cli/src/commands/index.js',
  'apps/cli/src/index.js',
  'docs/assets/aillive-code-terminal.png',
  'docs/assets/aillive_code.png',
  'package.json',
  'packages/agent-runtime/package.json',
  'packages/agent-runtime/src/index.js',
  'packages/core/package.json',
  'packages/core/src/index.js',
  'packages/git/package.json',
  'packages/git/src/index.js',
  'packages/lsp/package.json',
  'packages/lsp/src/index.js',
  'packages/mcp/package.json',
  'packages/mcp/src/index.js',
  'packages/memory/package.json',
  'packages/memory/src/index.js',
  'packages/provider/package.json',
  'packages/provider/src/index.js',
  'packages/tui/package.json',
  'packages/tui/src/index.js',
  'src/index.js',
]

async function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {}
  }
  throw new Error('npm CLI was not found. Run this script through npm or set npm_execpath.')
}

async function runNpm(args, options = {}) {
  const npmCli = await npmCliPath()
  return execFileAsync(process.execPath, [npmCli, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
    ...options,
  })
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function startMockApi() {
  let sawChat = false
  const server = http.createServer(async (req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      sawChat = true
      assert.equal(req.headers.authorization, 'Bearer ail_pack_smoke')
      assert.match(req.headers['user-agent'] || '', /aillive-cli\/\d+\.\d+\.\d+/)
      const payload = JSON.parse(await readRequestBody(req))
      assert.equal(payload.messages.at(-1).content, 'Hello from pack smoke')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        id: 'chatcmpl_pack_smoke',
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'pack smoke ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      }))
      return
    }
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    sawChat: () => sawChat,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-cli-pack-smoke-'))

try {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const pack = await runNpm(['pack', '--json', '--pack-destination', tempDir], { cwd: root })
  const [packed] = JSON.parse(pack.stdout)
  const tarball = path.join(tempDir, packed.filename)
  const actualFiles = packed.files.map((file) => file.path).sort()
  assert.deepEqual(actualFiles, [...expectedTarballFiles].sort(), 'packed tarball file list changed')
  assert.equal(packed.name, pkg.name)
  assert.equal(packed.version, pkg.version)

  const api = await startMockApi()
  try {
    const commonEnv = {
      ...process.env,
      AILLIVE_HOME: path.join(tempDir, '.aillive'),
      NO_COLOR: '1',
    }
    const chat = await runNpm([
      'exec',
      '--yes',
      '--package',
      tarball,
      '--',
      'aillive',
      '--api-key',
      'ail_pack_smoke',
      '--base-url',
      api.url,
      '--json',
      'chat',
      'Hello from pack smoke',
    ], {
      cwd: tempDir,
      env: commonEnv,
    })
    const chatPayload = JSON.parse(chat.stdout)
    assert.equal(api.sawChat(), true)
    assert.equal(chatPayload.choices[0].message.content, 'pack smoke ok')

    const version = await runNpm([
      'exec',
      '--yes',
      '--package',
      tarball,
      '--',
      'aillive-code',
      '--version',
    ], {
      cwd: tempDir,
      env: commonEnv,
    })
    assert.equal(version.stdout.trim(), pkg.version)
  } finally {
    await api.close()
  }

  console.log(`pack smoke ok: ${packed.filename} (${actualFiles.length} files)`)
} finally {
  await fs.rm(tempDir, { recursive: true, force: true })
}
