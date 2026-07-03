export const packageName = '@aillive/mcp'
export const packageRole = 'MCP server registry, tool listing, tool invocation, and permission policy.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'skeleton',
  }
}

export async function getMcpStatus(options = {}) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const home = String(options.home || '').trim()
  const configPath = options.configPath || (home ? path.join(home, 'mcp.json') : '')
  let configured = false
  let servers = []
  if (configPath) {
    try {
      const raw = await fs.readFile(configPath, 'utf8')
      const config = JSON.parse(raw)
      configured = true
      servers = Object.entries(config.servers || {}).map(([id, server]) => ({
        id,
        command: server.command || '',
        transport: server.transport || 'stdio',
        status: 'configured',
      }))
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return {
          component: 'mcp',
          package: packageName,
          status: 'invalid-config',
          configured: true,
          configPath,
          servers: [],
          error: error.message,
        }
      }
    }
  }
  return {
    component: 'mcp',
    package: packageName,
    status: configured ? 'configured' : 'disabled',
    configured,
    configPath,
    servers,
    tools: [],
  }
}
