import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
  throw new Error('npm CLI was not found. Run this smoke test through npm.')
}

async function runNpm(args, options = {}) {
  const npmCli = await npmCliPath()
  return execFileAsync(process.execPath, [npmCli, ...args], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    ...options,
  })
}

test('packed tarball runs through npx and calls chat mock', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-code-npx-'))
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }))

  let sawChat = false
  const server = http.createServer((req, res) => {
    if (req.url === '/chat/completions' && req.method === 'POST') {
      sawChat = true
      assert.equal(req.headers.authorization, 'Bearer ail_smoke')
      assert.match(req.headers['user-agent'] || '', /aillive-cli\/0\.1\.0/)
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        const payload = JSON.parse(body)
        assert.equal(payload.messages.at(-1).content, 'Hello from npx smoke')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          id: 'chatcmpl_npx_smoke',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'npx smoke ok' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
        }))
      })
      return
    }
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { message: 'not found' } }))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  const pack = await runNpm(['pack', '--json', '--pack-destination', tempDir], {
    cwd: root,
  })
  const [packed] = JSON.parse(pack.stdout)
  const tarball = path.join(tempDir, packed.filename)
  const { port } = server.address()

  const result = await runNpm([
    'exec',
    '--yes',
    '--package',
    tarball,
    '--',
    'aillive',
    '--api-key',
    'ail_smoke',
    '--base-url',
    `http://127.0.0.1:${port}`,
    '--json',
    'chat',
    'Hello from npx smoke',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      AILLIVE_HOME: path.join(tempDir, '.aillive'),
      NO_COLOR: '1',
    },
  })

  assert.equal(sawChat, true)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.choices[0].message.content, 'npx smoke ok')
})
