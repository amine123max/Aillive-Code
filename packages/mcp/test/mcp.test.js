import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  callMcpTool,
  connectMcpServers,
  createAilliveTool,
  createMockMcpServer,
  createToolTraceEvent,
  describeAilliveToolDefinition,
  enforceToolPermission,
  getMcpStatus,
  getAilliveToolSchema,
  listMcpTools,
  readMcpConfig,
  redactToolTrace,
} from '../src/index.js'

test('mcp exposes Aillive tool contract', async () => {
  const schema = getAilliveToolSchema()
  const echo = createAilliveTool({
    description: 'Echo text for tests',
    args: {
      text: schema.string(),
    },
    async execute(args) {
      return args.text
    },
  })

  assert.deepEqual(describeAilliveToolDefinition(echo), {
    description: 'Echo text for tests',
    args: ['text'],
    execute: true,
  })
  assert.equal(await echo.execute({ text: 'hello' }, {}), 'hello')
})

test('mcp status reports Aillive tool adapter without requiring servers', async () => {
  const status = await getMcpStatus({ home: '' })
  assert.equal(status.status, 'disabled')
  assert.equal(status.adapters[0].package, '@aillive/mcp')
  assert.equal(status.adapters[0].role, 'Aillive tool contract adapter')
  assert.equal(status.adapters[0].license, 'MIT')
})

test('mcp reads config, lists mock tools, and calls tools offline', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-mcp-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  await fs.writeFile(path.join(dir, 'mcp.json'), JSON.stringify({
    servers: {
      test: {
        transport: 'mock',
        tools: {
          canned: { description: 'Canned response', risk: 'read', response: 'ok' },
        },
      },
    },
  }), 'utf8')

  const loaded = await readMcpConfig({ home: dir })
  const servers = connectMcpServers(loaded.config)
  const tools = await listMcpTools(servers)
  const result = await callMcpTool({ servers, name: 'canned' })
  const status = await getMcpStatus({ home: dir })

  assert.equal(loaded.configured, true)
  assert.equal(tools[0].name, 'canned')
  assert.equal(result.output, 'ok')
  assert.equal(result.trace.type, 'mcp_tool_result')
  assert.equal(status.tools[0].name, 'canned')
})

test('mcp enforces high-risk confirmations and redacts traces', async () => {
  const server = createMockMcpServer({
    id: 'fs',
    tools: {
      write: {
        description: 'write',
        risk: 'filesystem',
        execute: () => 'token: ail_1234567890abcdef',
      },
    },
  })

  await assert.rejects(
    () => callMcpTool({ servers: [server], name: 'write' }),
    /requires confirmation/,
  )
  const result = await callMcpTool({ servers: [server], name: 'write', confirmed: true })
  assert.match(result.output, /ail_123/)
  assert.match(result.trace.metadata.output, /redacted/)
  assert.throws(() => enforceToolPermission({ name: 'write' }, { deny: ['write'] }), /denied/)
  assert.match(redactToolTrace('Authorization: Bearer sk_live_1234567890'), /redacted/)
  assert.equal(createToolTraceEvent({ name: 'noop' }, { output: 'ok' }, { trace: false }), null)
})
