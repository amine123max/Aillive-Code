export const packageName = '@aillive/lsp'
export const packageRole = 'Language server discovery, diagnostics, symbols, references, and workspace intelligence.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export const languageHints = [
  ['javascript', ['package.json', 'jsconfig.json']],
  ['typescript', ['tsconfig.json']],
  ['python', ['pyproject.toml', 'requirements.txt']],
  ['rust', ['Cargo.toml']],
  ['go', ['go.mod']],
]

export async function detectProjectLanguages(cwd = process.cwd()) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const detected = []
  for (const [language, files] of languageHints) {
    for (const file of files) {
      try {
        await fs.access(path.join(cwd, file))
        detected.push(language)
        break
      } catch {}
    }
  }
  return detected
}

export function encodeJsonRpcMessage(payload) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    ...payload,
  })
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

export function decodeJsonRpcMessages(input) {
  let buffer = String(input || '')
  const messages = []
  while (buffer) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const header = buffer.slice(0, headerEnd)
    const match = /content-length:\s*(\d+)/i.exec(header)
    if (!match) break
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) break
    messages.push(JSON.parse(buffer.slice(bodyStart, bodyEnd)))
    buffer = buffer.slice(bodyEnd)
  }
  return { messages, rest: buffer }
}

export function createMockJsonRpcTransport(handlers = {}) {
  const calls = []
  return {
    calls,
    async request(method, params = {}) {
      calls.push({ method, params })
      const handler = handlers[method]
      if (!handler) {
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
        }
      }
      return {
        jsonrpc: '2.0',
        result: await handler(params),
      }
    },
  }
}

export function createLspClient(transport) {
  return {
    async initialize(params = {}) {
      return transport.request('initialize', params)
    },
    async shutdown() {
      return transport.request('shutdown', null)
    },
    async workspaceSymbols(query = '') {
      return transport.request('workspace/symbol', { query })
    },
    async diagnostics(uri) {
      return transport.request('textDocument/diagnostic', { textDocument: { uri } })
    },
    async hover(uri, position) {
      return transport.request('textDocument/hover', { textDocument: { uri }, position })
    },
    async definition(uri, position) {
      return transport.request('textDocument/definition', { textDocument: { uri }, position })
    },
    async references(uri, position) {
      return transport.request('textDocument/references', { textDocument: { uri }, position })
    },
    async codeActions(uri, range, context = {}) {
      return transport.request('textDocument/codeAction', { textDocument: { uri }, range, context })
    },
  }
}

export function createLanguageServerProcessSpec(options = {}) {
  return {
    command: options.command || '',
    args: options.args || [],
    cwd: options.cwd || process.cwd(),
    transport: options.transport || 'stdio',
    env: options.env || {},
    status: options.command ? 'configured' : 'unavailable',
  }
}

export function createLanguageServerLifecycle(options = {}) {
  const spec = createLanguageServerProcessSpec(options)
  let state = spec.status === 'configured' ? 'configured' : 'unavailable'
  return {
    spec,
    state() {
      return state
    },
    async start() {
      state = spec.command ? 'running' : 'unavailable'
      return { ...spec, status: state }
    },
    async stop() {
      state = state === 'running' ? 'stopped' : state
      return { ...spec, status: state }
    },
  }
}

export function summarizeDiagnostics(diagnostics = []) {
  const severityCounts = { error: 0, warning: 0, information: 0, hint: 0 }
  for (const diagnostic of diagnostics) {
    const severity = diagnostic.severity === 1
      ? 'error'
      : (diagnostic.severity === 2 ? 'warning' : (diagnostic.severity === 3 ? 'information' : 'hint'))
    severityCounts[severity] += 1
  }
  return {
    available: true,
    count: diagnostics.length,
    severityCounts,
  }
}

export function codeActionMetadata(actions = []) {
  return actions.map((action) => ({
    title: action.title || '',
    kind: action.kind || '',
    isPreferred: Boolean(action.isPreferred),
    disabled: Boolean(action.disabled),
  }))
}

export function normalizeSymbols(symbols = []) {
  return symbols.map((symbol) => ({
    name: symbol.name || '',
    kind: symbol.kind || '',
    containerName: symbol.containerName || '',
    location: symbol.location || null,
  }))
}

export function buildWorkspaceSummary(input = {}) {
  const diagnostics = input.diagnosticsSummary
    || (Array.isArray(input.diagnostics)
      ? summarizeDiagnostics(input.diagnostics)
      : (input.diagnostics || summarizeDiagnostics([])))
  const symbols = normalizeSymbols(input.symbols || [])
  const git = input.git || {}
  return {
    cwd: input.cwd || process.cwd(),
    languages: input.languages || input.detectedLanguages || [],
    git: {
      branch: git.branch || '',
      dirty: Boolean(git.dirty),
      changedFiles: git.changedFiles || 0,
      diffSummary: git.diffSummary || [],
    },
    diagnostics,
    symbols: symbols.slice(0, input.maxSymbols || 20),
  }
}

export function buildAgentLspContext(input = {}) {
  const summary = buildWorkspaceSummary(input)
  return {
    status: input.status || (summary.languages.length ? 'available-for-project' : 'disabled'),
    summary,
    diagnostics: summary.diagnostics,
    symbolLookup: (query = '') => summary.symbols.filter((symbol) => (
      symbol.name.toLowerCase().includes(String(query).toLowerCase())
    )),
  }
}

export async function getLspStatus(options = {}) {
  const cwd = options.cwd || process.cwd()
  const detected = await detectProjectLanguages(cwd)
  const servers = Array.isArray(options.servers) ? options.servers : []
  const diagnostics = Array.isArray(options.diagnostics)
    ? summarizeDiagnostics(options.diagnostics)
    : { available: false, count: 0 }
  const codeActions = Array.isArray(options.codeActions)
    ? codeActionMetadata(options.codeActions)
    : []
  return {
    component: 'lsp',
    package: packageName,
    status: servers.length ? 'configured' : (detected.length ? 'available-for-project' : 'disabled'),
    configured: servers.length > 0,
    cwd,
    detectedLanguages: detected,
    servers,
    diagnostics,
    codeActions,
    workspace: buildWorkspaceSummary({
      cwd,
      languages: detected,
      diagnosticsSummary: diagnostics,
      symbols: options.symbols || [],
      git: options.git || {},
    }),
  }
}
