import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const packageName = '@aillive/core'
export const packageRole = 'Core utilities for config, paths, parsing, errors, formatting, and auth helpers.'
export const VERSION = '0.1.0'
export const DEFAULT_BASE_URL = 'https://www.aillive.xyz/api/v1'
export const PROJECT_DIR_NAME = '.aillive'
export const PROJECT_CONTEXT_FILE = 'project.md'
export const MAX_PROJECT_CONTEXT_CHARS = 12000

export const cliErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  API_REQUEST_FAILED: 'API_REQUEST_FAILED',
  CONFIG_INVALID: 'CONFIG_INVALID',
  SUBSYSTEM_UNAVAILABLE: 'SUBSYSTEM_UNAVAILABLE',
  COMMAND_USAGE: 'COMMAND_USAGE',
}

export class AilliveCliError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'AilliveCliError'
    this.code = code || cliErrorCodes.COMMAND_USAGE
    this.status = Number(options.status || 1)
    this.detail = options.detail || null
  }
}

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export function createCliError(code, message, options = {}) {
  return new AilliveCliError(code, message, options)
}

export function errorToJson(error) {
  return {
    ok: false,
    error: {
      code: error?.code || cliErrorCodes.COMMAND_USAGE,
      message: error?.message || 'Command failed.',
      ...(error?.detail ? { detail: error.detail } : {}),
    },
  }
}

export function detectOutputMode(options = {}, env = process.env) {
  const json = Boolean(options.json || env.AILLIVE_OUTPUT === 'json')
  const color = Boolean(options.color !== false && env.NO_COLOR === undefined && !json)
  return { json, color }
}

export function resolveAillivePaths(home = process.env.AILLIVE_HOME) {
  const configDir = home ? path.resolve(home) : path.join(os.homedir(), '.aillive')
  const sessionsDir = path.join(configDir, 'sessions')
  return {
    configDir,
    configFile: path.join(configDir, 'config.json'),
    authFile: path.join(configDir, 'auth.json'),
    sessionsDir,
    sessionsFile: path.join(sessionsDir, 'index.json'),
    statsFile: path.join(configDir, 'stats.json'),
    projectsDir: path.join(configDir, 'projects'),
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

export async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonFile(file, data, mode = 0o600) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode })
  if (process.platform !== 'win32') await fs.chmod(file, mode)
}

export function parseArgv(argv) {
  const global = {
    json: false,
    color: true,
    apiKey: '',
    baseUrl: '',
    model: '',
    stream: false,
    force: false,
    open: false,
    project: false,
    noProject: false,
    system: '',
    cwd: '',
    dataDir: '',
    offline: false,
    trace: false,
    verify: false,
  }
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg)
      continue
    }

    const [name, inlineValue] = arg.split('=', 2)
    const nextValue = () => inlineValue ?? argv[++index] ?? ''
    switch (name) {
      case '-h':
      case '--help':
        global.help = true
        break
      case '-v':
      case '--version':
        global.version = true
        break
      case '--json':
        global.json = true
        break
      case '--no-color':
        global.color = false
        break
      case '--api-key':
        global.apiKey = nextValue()
        break
      case '--base-url':
        global.baseUrl = nextValue()
        break
      case '--model':
        global.model = nextValue()
        break
      case '--project':
        global.project = true
        break
      case '--no-project':
        global.noProject = true
        break
      case '--system':
        global.system = nextValue()
        break
      case '--cwd':
        global.cwd = nextValue()
        break
      case '--data-dir':
        global.dataDir = nextValue()
        break
      case '--stream':
        global.stream = true
        break
      case '--force':
        global.force = true
        break
      case '--open':
        global.open = true
        break
      case '--offline':
        global.offline = true
        break
      case '--trace':
        global.trace = true
        break
      case '--verify':
        global.verify = true
        break
      case '--from':
        global.from = nextValue()
        break
      case '--to':
        global.to = nextValue()
        break
      default:
        positionals.push(arg)
    }
  }

  return {
    command: positionals[0] || '',
    subcommand: positionals[1] || '',
    args: positionals.slice(1),
    rest: positionals.slice(2),
    global,
  }
}

export function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) throw new Error('base-url must start with http:// or https://')
  return raw
}

export function safeParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function authHeaders(apiKey) {
  if (!apiKey) throw new Error('Missing API key. Run `aillive auth login` or place auth.json in ~/.aillive.')
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'user-agent': `aillive-cli/${VERSION}`,
  }
}

export function maskSecret(value) {
  const text = String(value || '')
  return text ? `${text.slice(0, 8)}...${text.slice(-6)}` : ''
}

export function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '')
}

export function colorize(text, code, enabled = true) {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : String(text)
}

export function formatKeyValueRows(rows = []) {
  const normalized = rows.map((row) => ({
    key: String(row.key ?? row[0] ?? ''),
    value: String(row.value ?? row[1] ?? ''),
  }))
  const width = Math.max(0, ...normalized.map((row) => row.key.length))
  return normalized.map((row) => `${row.key.padEnd(width)}  ${row.value}`).join('\n')
}

export function formatPanel(title, lines = []) {
  const body = Array.isArray(lines) ? lines : [lines]
  return [`[${title}]`, ...body.map((line) => String(line))].join('\n')
}

export function normalizeAuthPayload(payload = {}, fallback = {}) {
  const apiKey = String(payload.apiKey || payload.key || payload.secret || payload.token || '').trim()
  if (!apiKey) {
    throw createCliError(cliErrorCodes.CONFIG_INVALID, 'auth.json must include apiKey.')
  }
  return {
    type: 'aillive_cli_auth',
    version: 1,
    apiKey,
    baseUrl: normalizeBaseUrl(payload.baseUrl || fallback.baseUrl || DEFAULT_BASE_URL),
    profile: payload.profile || fallback.profile || null,
    source: payload.source || fallback.source || 'auth.json',
    createdAt: payload.createdAt || fallback.createdAt || new Date().toISOString(),
    importedAt: payload.importedAt || new Date().toISOString(),
  }
}
