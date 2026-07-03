import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildAgentLspContext,
  buildWorkspaceSummary,
  codeActionMetadata,
  createLspClient,
  createLanguageServerLifecycle,
  createMockJsonRpcTransport,
  decodeJsonRpcMessages,
  detectProjectLanguages,
  encodeJsonRpcMessage,
  getLspStatus,
  summarizeDiagnostics,
} from '../src/index.js'

test('lsp detects project languages from workspace files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-lsp-project-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}\n', 'utf8')
  await fs.writeFile(path.join(dir, 'tsconfig.json'), '{}\n', 'utf8')

  const languages = await detectProjectLanguages(dir)
  const status = await getLspStatus({ cwd: dir })

  assert.deepEqual(languages, ['javascript', 'typescript'])
  assert.equal(status.status, 'available-for-project')
  assert.deepEqual(status.detectedLanguages, ['javascript', 'typescript'])
})

test('lsp encodes and decodes JSON-RPC messages with partial rest', () => {
  const encoded = encodeJsonRpcMessage({ id: 1, method: 'initialize', params: { rootUri: 'file:///tmp/app' } })
  const decoded = decodeJsonRpcMessages(`${encoded}partial`)

  assert.equal(decoded.messages.length, 1)
  assert.equal(decoded.messages[0].jsonrpc, '2.0')
  assert.equal(decoded.messages[0].method, 'initialize')
  assert.equal(decoded.rest, 'partial')
})

test('lsp mock JSON-RPC client supports initialize, symbols, diagnostics, hover, and shutdown', async () => {
  const transport = createMockJsonRpcTransport({
    initialize: () => ({ capabilities: { hoverProvider: true, workspaceSymbolProvider: true } }),
    'workspace/symbol': ({ query }) => [{ name: query, kind: 12 }],
    'textDocument/diagnostic': () => ({ items: [{ message: 'broken', severity: 1 }] }),
    'textDocument/hover': () => ({ contents: 'hello symbol' }),
    'textDocument/codeAction': () => [{ title: 'Fix issue', kind: 'quickfix', isPreferred: true }],
    shutdown: () => null,
  })
  const client = createLspClient(transport)

  const init = await client.initialize({ rootUri: 'file:///tmp/app' })
  const symbols = await client.workspaceSymbols('Aillive')
  const diagnostics = await client.diagnostics('file:///tmp/app/index.js')
  const hover = await client.hover('file:///tmp/app/index.js', { line: 0, character: 1 })
  const actions = await client.codeActions('file:///tmp/app/index.js', {}, {})
  const shutdown = await client.shutdown()

  assert.equal(init.result.capabilities.hoverProvider, true)
  assert.equal(symbols.result[0].name, 'Aillive')
  assert.equal(diagnostics.result.items[0].severity, 1)
  assert.equal(hover.result.contents, 'hello symbol')
  assert.equal(actions.result[0].kind, 'quickfix')
  assert.equal(shutdown.result, null)
  assert.deepEqual(transport.calls.map((call) => call.method), [
    'initialize',
    'workspace/symbol',
    'textDocument/diagnostic',
    'textDocument/hover',
    'textDocument/codeAction',
    'shutdown',
  ])
})

test('lsp summarizes diagnostics by severity', () => {
  const summary = summarizeDiagnostics([
    { severity: 1 },
    { severity: 2 },
    { severity: 2 },
    { severity: 4 },
  ])

  assert.equal(summary.available, true)
  assert.equal(summary.count, 4)
  assert.equal(summary.severityCounts.error, 1)
  assert.equal(summary.severityCounts.warning, 2)
  assert.equal(summary.severityCounts.hint, 1)
})

test('lsp exposes lifecycle, code action metadata, and agent workspace context', () => {
  const lifecycle = createLanguageServerLifecycle({ command: 'typescript-language-server', args: ['--stdio'], cwd: 'C:/tmp/app' })
  assert.equal(lifecycle.state(), 'configured')
  const actions = codeActionMetadata([{ title: 'Fix', kind: 'quickfix', isPreferred: true }])
  const workspace = buildWorkspaceSummary({
    cwd: 'C:/tmp/app',
    languages: ['typescript'],
    diagnostics: [{ severity: 1 }],
    symbols: [{ name: 'AilliveClient', kind: 5 }],
    git: { branch: 'main', dirty: true, changedFiles: 1, diffSummary: ['index.js | 2 +-'] },
  })
  const agentContext = buildAgentLspContext({ ...workspace, status: 'available-for-project' })

  assert.equal(actions[0].isPreferred, true)
  assert.equal(workspace.diagnostics.severityCounts.error, 1)
  assert.equal(workspace.git.dirty, true)
  assert.equal(agentContext.symbolLookup('client')[0].name, 'AilliveClient')
})
