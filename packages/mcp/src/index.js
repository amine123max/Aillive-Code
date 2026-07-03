import { tool as ailliveToolContract } from '@mimo-ai/plugin/tool'

export const packageName = '@aillive/mcp'
export const packageRole = 'MCP server registry, tool listing, tool invocation, and permission policy.'

export const defaultMcpPolicy = {
  defaultAction: 'allow',
  deny: [],
  confirm: [],
  timeoutMs: 30000,
  maxOutputChars: 12000,
  trace: true,
}

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export const ailliveToolAdapter = {
  package: '@aillive/mcp',
  version: '0.1.4',
  role: 'Aillive tool contract adapter',
  license: 'MIT',
}

export function createAilliveTool(input) {
  return ailliveToolContract(input)
}

export function getAilliveToolSchema() {
  return ailliveToolContract.schema
}

export function describeAilliveToolDefinition(definition) {
  return {
    description: definition.description || '',
    args: Object.keys(definition.args || {}),
    execute: typeof definition.execute === 'function',
  }
}

function normalizePolicy(policy = {}) {
  return { ...defaultMcpPolicy, ...policy }
}

function serverEntries(config = {}) {
  return Object.entries(config.servers || {}).map(([id, server]) => ({
    id,
    transport: server.transport || 'stdio',
    command: server.command || '',
    args: server.args || [],
    env: server.env || {},
    disabled: Boolean(server.disabled),
    tools: server.tools || {},
  }))
}

export async function readMcpConfig(options = {}) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const home = String(options.home || '').trim()
  const configPath = options.configPath || (home ? path.join(home, 'mcp.json') : '')
  if (!configPath) return { configured: false, configPath, config: { servers: {} }, errors: [] }
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const config = JSON.parse(raw)
    const errors = validateMcpConfig(config)
    return { configured: true, configPath, config, errors }
  } catch (error) {
    if (error?.code === 'ENOENT') return { configured: false, configPath, config: { servers: {} }, errors: [] }
    return { configured: true, configPath, config: { servers: {} }, errors: [error.message] }
  }
}

export function validateMcpConfig(config = {}) {
  const errors = []
  if (typeof config !== 'object' || Array.isArray(config)) return ['MCP config must be an object.']
  if (config.servers && (typeof config.servers !== 'object' || Array.isArray(config.servers))) {
    errors.push('servers must be an object.')
  }
  for (const server of serverEntries(config)) {
    if (!server.id) errors.push('server id is required.')
    if (!['stdio', 'mock', 'sse', 'http'].includes(server.transport)) {
      errors.push(`${server.id}: unsupported transport ${server.transport}.`)
    }
    if (server.transport === 'stdio' && !server.command) {
      errors.push(`${server.id}: stdio server requires command.`)
    }
  }
  return errors
}

export function createMockMcpServer(options = {}) {
  const id = options.id || 'mock'
  const tools = options.tools || {}
  return {
    id,
    transport: 'mock',
    status: 'connected',
    async listTools() {
      return Object.entries(tools).map(([name, definition]) => ({
        server: id,
        name,
        description: definition.description || '',
        risk: definition.risk || 'read',
        highRisk: Boolean(definition.highRisk || definition.destructive || ['write', 'shell', 'filesystem', 'network'].includes(definition.risk)),
      }))
    },
    async callTool(name, args = {}, context = {}) {
      const definition = tools[name]
      if (!definition) throw new Error(`Unknown MCP tool: ${name}`)
      const execute = typeof definition === 'function' ? definition : definition.execute
      if (definition && typeof definition === 'object' && Object.hasOwn(definition, 'response')) return definition.response
      if (typeof execute !== 'function') throw new Error(`MCP tool is not callable: ${name}`)
      return execute(args, context)
    },
  }
}

export function connectMcpServers(config = {}, options = {}) {
  const injected = options.servers || {}
  const connected = []
  for (const server of serverEntries(config)) {
    if (server.disabled) {
      connected.push({ ...server, status: 'disabled' })
      continue
    }
    if (server.transport === 'mock') {
      connected.push(createMockMcpServer({
        id: server.id,
        tools: injected[server.id]?.tools || server.tools,
      }))
      continue
    }
    connected.push({ ...server, status: 'configured' })
  }
  return connected
}

export function listMcpTools(servers = []) {
  return Promise.all((servers || []).map(async (server) => {
    if (typeof server.listTools !== 'function') return []
    return server.listTools()
  })).then((groups) => groups.flat())
}

export function evaluateToolPermission(tool = {}, policy = {}) {
  const activePolicy = normalizePolicy(policy)
  const name = tool.name || tool.id || ''
  if (activePolicy.deny.includes(name) || activePolicy.deny.includes('*')) return { action: 'deny', reason: 'policy deny rule' }
  const highRisk = tool.highRisk || tool.destructive || ['write', 'shell', 'filesystem', 'network'].includes(tool.risk)
  if (activePolicy.confirm.includes(name) || activePolicy.confirm.includes('*') || highRisk) {
    return { action: 'confirm', reason: highRisk ? 'high-risk tool' : 'policy confirm rule' }
  }
  return { action: activePolicy.defaultAction || 'allow', reason: 'default policy' }
}

export function enforceToolPermission(tool = {}, policy = {}, options = {}) {
  const decision = evaluateToolPermission(tool, policy)
  if (decision.action === 'deny') {
    const error = new Error(`MCP tool denied by policy: ${tool.name || tool.id || '(unknown)'}`)
    error.code = 'MCP_TOOL_DENIED'
    error.decision = decision
    throw error
  }
  if (decision.action === 'confirm' && !options.confirmed) {
    const error = new Error(`MCP tool requires confirmation: ${tool.name || tool.id || '(unknown)'}`)
    error.code = 'MCP_TOOL_CONFIRMATION_REQUIRED'
    error.decision = decision
    throw error
  }
  return decision
}

export function trimToolOutput(value = '', policy = {}) {
  const activePolicy = normalizePolicy(policy)
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= activePolicy.maxOutputChars) return text
  return `${text.slice(0, activePolicy.maxOutputChars)}\n[truncated ${text.length - activePolicy.maxOutputChars} chars]`
}

export function redactToolTrace(value = '') {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {})
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/_-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\bail_[A-Za-z0-9._~+/-]{8,}/gi, 'ail_[redacted]')
    .replace(/(\b(?:api[_-]?key|token|secret|authorization)\b)(["'\s:=]+)[A-Za-z0-9._~+/_-]{8,}/gi, '$1$2[redacted]')
}

export function createToolTraceEvent(tool = {}, result = {}, policy = {}) {
  const activePolicy = normalizePolicy(policy)
  if (!activePolicy.trace) return null
  return {
    type: 'mcp_tool_result',
    at: new Date().toISOString(),
    metadata: {
      tool: tool.name || tool.id || '',
      server: tool.server || '',
      ok: result.ok !== false,
      output: redactToolTrace(trimToolOutput(result.output ?? result, activePolicy)),
    },
  }
}

export async function callMcpTool(options = {}) {
  const servers = options.servers || []
  const name = options.name || options.tool || ''
  const serverId = options.server || ''
  const tools = await listMcpTools(servers)
  const tool = tools.find((item) => item.name === name && (!serverId || item.server === serverId))
  if (!tool) throw new Error(`Unknown MCP tool: ${name}`)
  enforceToolPermission(tool, options.policy, { confirmed: options.confirmed })
  const server = servers.find((item) => item.id === tool.server)
  if (!server || typeof server.callTool !== 'function') throw new Error(`MCP server is not connected: ${tool.server}`)
  const raw = await server.callTool(name, options.args || {}, options.context || {})
  const output = trimToolOutput(raw, options.policy)
  return {
    ok: true,
    tool,
    output,
    trace: createToolTraceEvent(tool, { ok: true, output }, options.policy),
  }
}

export async function getMcpStatus(options = {}) {
  const loaded = await readMcpConfig(options)
  const connected = connectMcpServers(loaded.config, options)
  const tools = await listMcpTools(connected)
  if (loaded.errors.length) {
    return {
      component: 'mcp',
      package: packageName,
      status: 'invalid-config',
      configured: loaded.configured,
      configPath: loaded.configPath,
      servers: connected.map((server) => ({
        id: server.id,
        command: server.command || '',
        transport: server.transport || 'stdio',
        status: server.status || 'configured',
      })),
      tools,
      error: loaded.errors.join('; '),
      adapters: [ailliveToolAdapter],
    }
  }
  return {
    component: 'mcp',
    package: packageName,
    status: loaded.configured ? 'configured' : 'disabled',
    configured: loaded.configured,
    configPath: loaded.configPath,
    servers: connected.map((server) => ({
      id: server.id,
      command: server.command || '',
      transport: server.transport || 'stdio',
      status: server.status || 'configured',
    })),
    tools,
    policy: defaultMcpPolicy,
    adapters: [ailliveToolAdapter],
  }
}
