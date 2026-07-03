import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  ProviderError,
  checkProviderStatus,
  createChatCompletion,
  extractContent,
  getProviderStatus,
  listModels,
  loadUsage,
  normalizeModel,
  requestJson,
  runOpenClawTask,
  streamChatCompletion,
} from '../src/index.js'

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function startServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('provider status describes configured Aillive and OpenAI-compatible providers', () => {
  const status = getProviderStatus({
    baseUrl: 'http://127.0.0.1:3000',
    apiKey: 'ail_test',
    model: 'mock-model',
  })
  assert.equal(status.component, 'provider')
  assert.equal(status.status, 'configured')
  assert.equal(status.authenticated, true)
  assert.equal(status.providers.length, 2)
  assert.equal(status.providers[0].capabilities.includes('openclaw'), true)
})

test('provider status verifies models endpoint when authenticated', async (t) => {
  const server = await startServer((req, res) => {
    assert.equal(req.url, '/models')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'mock-model', owned_by: 'aillive' }] }))
  })
  t.after(server.close)

  const status = await checkProviderStatus({
    baseUrl: server.baseUrl,
    apiKey: 'ail_test',
    model: 'mock-model',
  })

  assert.equal(status.status, 'ready')
  assert.equal(status.checks.models, true)
  assert.equal(status.models.count, 1)
})

test('provider status returns remediation hint when models check fails', async (t) => {
  const server = await startServer((req, res) => {
    assert.equal(req.url, '/models')
    res.statusCode = 503
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { message: 'maintenance' } }))
  })
  t.after(server.close)

  const status = await checkProviderStatus({
    baseUrl: server.baseUrl,
    apiKey: 'ail_test',
    model: 'mock-model',
  })

  assert.equal(status.status, 'degraded')
  assert.equal(status.checks.models, false)
  assert.match(status.models.error, /maintenance/)
  assert.match(status.remediationHint, /Check provider base URL/)
})

test('normalizes model records from simplified provider metadata', () => {
  const model = normalizeModel({
    name: 'mock-model',
    owner: 'aillive',
    max_context_tokens: 8192,
    supports_tools: true,
  })
  assert.equal(model.id, 'mock-model')
  assert.equal(model.label, 'mock-model')
  assert.equal(model.owned_by, 'aillive')
  assert.equal(model.contextWindow, 8192)
  assert.equal(model.supports.streaming, true)
  assert.equal(model.supports.tools, true)
})

test('lists models through a local HTTP mock and redacts auth in trace events', async (t) => {
  const trace = []
  const server = await startServer((req, res) => {
    assert.equal(req.url, '/models')
    assert.equal(req.headers.authorization, 'Bearer ail_secret_test')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      object: 'list',
      data: [{ id: 'mock-model', label: 'Mock Model', owned_by: 'aillive' }],
    }))
  })
  t.after(server.close)

  const data = await listModels({
    baseUrl: server.baseUrl,
    apiKey: 'ail_secret_test',
    onTrace: (event) => trace.push(event),
  })

  assert.equal(data.data[0].id, 'mock-model')
  assert.equal(JSON.stringify(trace).includes('ail_secret_test'), false)
  assert.equal(JSON.stringify(trace).includes('[redacted]'), true)
})

test('creates chat completions and extracts assistant content', async (t) => {
  const server = await startServer(async (req, res) => {
    assert.equal(req.url, '/chat/completions')
    assert.equal(req.method, 'POST')
    const body = JSON.parse(await readBody(req))
    assert.equal(body.messages[0].content, 'hello')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'hi there' } }],
    }))
  })
  t.after(server.close)

  const data = await createChatCompletion({
    baseUrl: server.baseUrl,
    apiKey: 'ail_test',
    body: { messages: [{ role: 'user', content: 'hello' }] },
  })

  assert.equal(extractContent(data), 'hi there')
})

test('streams chat completions from partial SSE chunks', async (t) => {
  const server = await startServer((req, res) => {
    assert.equal(req.url, '/chat/completions')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: {"choices":[{"delta":{"content":"Hel')
    res.write('lo"}}]}\n\n')
    res.write('data: {"choices":[{"delta":{"content":"!"}}]}\n\n')
    res.write('data: {"delta":{"content":"?"}}\n\n')
    res.end('data: [DONE]\n\n')
  })
  t.after(server.close)

  const deltas = []
  const content = await streamChatCompletion({
    baseUrl: server.baseUrl,
    apiKey: 'ail_test',
    body: { messages: [{ role: 'user', content: 'hello' }], stream: true },
    onDelta: (delta) => deltas.push(delta),
  })

  assert.equal(content, 'Hello!?')
  assert.deepEqual(deltas, ['Hello', '!', '?'])
})

test('loads usage and runs OpenClaw task endpoints', async (t) => {
  const server = await startServer(async (req, res) => {
    if (req.url === '/usage?from=2026-07-01&to=2026-07-31') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ usage: { chatRequests: 2 } }))
      return
    }
    if (req.url === '/openclaw/v1/tasks') {
      const body = JSON.parse(await readBody(req))
      assert.equal(body.task, 'draft flow')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ task: { result: 'done' } }))
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  t.after(server.close)

  const usage = await loadUsage({
    baseUrl: server.baseUrl,
    apiKey: 'ail_test',
    from: '2026-07-01',
    to: '2026-07-31',
  })
  const openclaw = await runOpenClawTask({
    baseUrl: `${server.baseUrl}/v1`,
    apiKey: 'ail_test',
    task: 'draft flow',
  })

  assert.equal(usage.usage.chatRequests, 2)
  assert.equal(openclaw.task.result, 'done')
})

test('requestJson throws provider errors with status and payload', async (t) => {
  const server = await startServer((req, res) => {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { message: 'upstream unavailable' } }))
  })
  t.after(server.close)

  await assert.rejects(
    () => requestJson(`${server.baseUrl}/models`, {
      headers: { authorization: 'Bearer ail_test' },
    }),
    (error) => {
      assert.equal(error instanceof ProviderError, true)
      assert.equal(error.status, 500)
      assert.match(error.message, /upstream unavailable/)
      return true
    },
  )
})
