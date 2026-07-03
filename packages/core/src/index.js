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

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
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
