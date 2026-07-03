#!/usr/bin/env node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

export const VERSION = '0.1.0'
export const DEFAULT_BASE_URL = 'https://www.aillive.xyz/api/v1'

const CONFIG_DIR = process.env.AILLIVE_HOME ? path.resolve(process.env.AILLIVE_HOME) : path.join(os.homedir(), '.aillive')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json')
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions')
const SESSIONS_FILE = path.join(SESSIONS_DIR, 'index.json')
const STATS_FILE = path.join(CONFIG_DIR, 'stats.json')
const PROJECTS_DIR = path.join(CONFIG_DIR, 'projects')
const PROJECT_DIR_NAME = '.aillive'
const PROJECT_CONTEXT_FILE = 'project.md'
const MAX_PROJECT_CONTEXT_CHARS = 12000

const TOP_LEVEL_COMMANDS = [
  'auth',
  'login',
  'logout',
  'status',
  'home',
  'setup',
  'install',
  'config',
  'interactive',
  'ask',
  'chat',
  'run',
  'models',
  'init',
  'context',
  'session',
  'stats',
  'openclaw',
  'usage',
  'admin',
  'doctor',
  'completions',
  'upgrade',
]

const COMMAND_GROUPS = [
  {
    title: 'Start',
    commands: [
      ['aillive', 'Open interactive AI terminal'],
      ['aillive interactive', 'Open interactive AI terminal explicitly'],
      ['aillive setup', 'Configure API key, base URL, and default model'],
      ['aillive login', 'Shortcut for auth login'],
      ['aillive status', 'Show local auth, project, and usage status'],
      ['aillive home', 'Show or open the local ~/.aillive directory'],
      ['aillive auth login', 'Open browser login and save ~/.aillive/auth.json'],
      ['aillive auth import auth.json', 'Import a downloaded auth.json file'],
      ['aillive install', 'Print terminal install commands'],
      ['aillive doctor', 'Check local config and API availability'],
    ],
  },
  {
    title: 'AI',
    commands: [
      ['aillive ask "prompt"', 'Alias for chat'],
      ['aillive chat "prompt"', 'Send a chat completion request'],
      ['aillive chat --stream "prompt"', 'Stream the answer in the terminal'],
      ['aillive run --project "task"', 'Run a task with ~/.aillive project context'],
      ['aillive models', 'List available Aillive models'],
    ],
  },
  {
    title: 'Project',
    commands: [
      ['aillive init', 'Create project context under ~/.aillive/projects'],
      ['aillive context status', 'Check project context availability'],
      ['aillive context show', 'Print the stored project context'],
      ['aillive session list', 'Show local CLI sessions'],
      ['aillive stats', 'Show local CLI usage statistics'],
    ],
  },
  {
    title: 'Platform',
    commands: [
      ['aillive openclaw run "task"', 'Run an Aillive OpenClaw task'],
      ['aillive usage', 'Query account usage summary'],
      ['aillive admin promote <email>', 'Promote an existing local user to admin'],
      ['aillive auth path', 'Print the local auth.json path'],
      ['aillive config list', 'Show local CLI config'],
      ['aillive completions powershell', 'Print shell completion script'],
    ],
  },
]

const color = {
  bold: (text, enabled) => enabled ? `\x1b[1m${text}\x1b[0m` : text,
  dim: (text, enabled) => enabled ? `\x1b[2m${text}\x1b[0m` : text,
  green: (text, enabled) => enabled ? `\x1b[32m${text}\x1b[0m` : text,
  red: (text, enabled) => enabled ? `\x1b[31m${text}\x1b[0m` : text,
  cyan: (text, enabled) => enabled ? `\x1b[36m${text}\x1b[0m` : text,
  magenta: (text, enabled) => enabled ? `\x1b[35m${text}\x1b[0m` : text,
  yellow: (text, enabled) => enabled ? `\x1b[33m${text}\x1b[0m` : text,
  gray: (text, enabled) => enabled ? `\x1b[90m${text}\x1b[0m` : text,
}

function canUseColor(enabled = true) {
  return Boolean(enabled && process.stdout.isTTY && process.env.NO_COLOR === undefined)
}

function line(width = 64) {
  return '-'.repeat(width)
}

function rule(width = 64, char = '-') {
  return char.repeat(Math.max(0, width))
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '')
}

function visibleLength(value) {
  return stripAnsi(value).length
}

function padEndVisual(value, width) {
  const text = String(value ?? '')
  return `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`
}

function fitVisual(value, width) {
  const text = String(value ?? '')
  if (visibleLength(text) <= width) return text
  const plain = stripAnsi(text)
  return `${plain.slice(0, Math.max(0, width - 3))}...`
}

function indentBlock(value, spaces = 2) {
  const prefix = ' '.repeat(spaces)
  return String(value || '').split('\n').map((item) => `${prefix}${item}`).join('\n')
}

function formatBox(lines, enabled = true, width = Math.min(terminalWidth(), 72)) {
  const innerWidth = width - 4
  const border = `+${'-'.repeat(width - 2)}+`
  const body = lines.map((item) => `| ${padEndVisual(fitVisual(item, innerWidth), innerWidth)} |`)
  return [border, ...body, border].join('\n')
}

function frame(title, rows, rt = {}, options = {}) {
  const useColor = canUseColor(rt.color)
  const width = options.width || Math.min(terminalWidth(), 104)
  const topTitle = title ? ` ${title} ` : ''
  const fill = rule(width - 2 - visibleLength(topTitle), '-')
  const innerWidth = width - 4
  const top = `+${topTitle}${fill}+`
  const bottom = `+${rule(width - 2, '-')}+`
  const body = rows.map((row) => `| ${padEndVisual(fitVisual(row, innerWidth), innerWidth)} |`)
  const rendered = [top, ...body, bottom].join('\n')
  return options.muted ? color.gray(rendered, useColor) : rendered
}

function formatCommandBlock(lines) {
  return lines.map((item) => `  $ ${item}`).join('\n')
}

function terminalWidth() {
  const columns = Number(process.stdout.columns || process.env.COLUMNS || 96)
  return Math.max(24, Math.min(Number.isFinite(columns) ? columns : 96, 128))
}

function terminalColumns() {
  const columns = Number(process.stdout.columns || process.env.COLUMNS || 96)
  return Math.max(24, Number.isFinite(columns) ? columns : 96)
}

function centerLine(value, width = terminalColumns()) {
  const text = String(value || '')
  return `${' '.repeat(Math.max(0, Math.floor((width - visibleLength(text)) / 2)))}${text}`
}

function centerFitLine(value, width = terminalColumns()) {
  return centerLine(fitVisual(value, Math.max(1, width)), width)
}

function clearInteractiveScreen(rt = {}) {
  if (!rt.json && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H')
}

function statusText(label, value, ok, rt = {}) {
  const useColor = canUseColor(rt.color)
  const state = ok ? color.green(String(value), useColor) : color.red(String(value), useColor)
  return `${color.gray(label, useColor)} ${state}`
}

function statusChip(label, value, tone = 'muted', rt = {}) {
  const useColor = canUseColor(rt.color)
  const paint = {
    ok: color.green,
    warn: color.yellow,
    bad: color.red,
    info: color.cyan,
    accent: color.magenta,
    muted: color.gray,
  }[tone] || color.gray
  return `${color.gray(label.toUpperCase(), useColor)} ${paint(String(value), useColor)}`
}

const WORDMARK = [
  ' ████████   ██████   ██        ██        ██████   ██      ██  ████████ ',
  '██████████  ██████   ██        ██        ██████   ██      ██  ████████ ',
  '██      ██    ██     ██        ██          ██     ██      ██  ██       ',
  '██      ██    ██     ██        ██          ██     ██      ██  ██       ',
  '██████████    ██     ██        ██          ██     ██      ██  ███████  ',
  '██████████    ██     ██        ██          ██      ██    ██   ███████  ',
  '██      ██    ██     ██        ██          ██       ██  ██    ██       ',
  '██      ██    ██     ██        ██          ██        ████     ██       ',
  '██      ██  ██████   ████████  ████████  ██████      ██      ████████ ',
  '██      ██  ██████   ████████  ████████  ██████      ██      ████████ ',
]

const COMPACT_WORDMARK = [
  ' █████╗ ██╗██╗     ██╗     ██╗██╗   ██╗███████╗',
  '██╔══██╗██║██║     ██║     ██║██║   ██║██╔════╝',
  '███████║██║██║     ██║     ██║██║   ██║█████╗  ',
  '██╔══██║██║██║     ██║     ██║╚██╗ ██╔╝██╔══╝  ',
  '██║  ██║██║███████╗███████╗██║ ╚████╔╝ ███████╗',
  '╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚═╝  ╚═══╝  ╚══════╝',
]

export function wordmarkForWidth(width = terminalColumns()) {
  const maxWidth = Math.max(...WORDMARK.map(visibleLength))
  if (width >= maxWidth + 4) return WORDMARK
  const compactWidth = Math.max(...COMPACT_WORDMARK.map(visibleLength))
  if (width >= compactWidth + 4) return COMPACT_WORDMARK
  return ['AILLIVE']
}

function printMiniSection(title, rows, rt = {}) {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  console.log(color.bold(title, useColor))
  for (const row of rows) console.log(`  ${row}`)
}

function interactivePrompt(rt = {}) {
  const useColor = canUseColor(rt.color)
  if (!useColor) return '> '
  return '\x1b[48;5;236m\x1b[37m› '
}

function resetPromptStyle(rt = {}) {
  if (canUseColor(rt.color)) process.stdout.write('\x1b[0m')
}

function printAuthFlowCard(rt = {}, loginUrl = '') {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  console.log('')
  console.log(`${color.yellow('Login required', useColor)} ${color.gray('-', useColor)} browser auth is needed for this request.`)
  console.log(`${color.gray('Open', useColor)}   ${loginUrl}`)
  console.log(`${color.gray('Save', useColor)}   ${color.cyan('auth.json', useColor)} ${color.gray('to', useColor)} ${AUTH_FILE}`)
}

function printInteractiveHelp(rt = {}) {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  const width = Math.min(terminalWidth(), 104)
  const groups = [
    ['Session', [
      ['/help', 'Show this command palette'],
      ['/status', 'Show auth, model, project, and local paths'],
      ['/clear', 'Clear the current conversation memory'],
      ['/exit', 'Leave interactive mode'],
    ]],
    ['Identity', [
      ['/login', 'Browser login, then import ~/.aillive/auth.json'],
      ['/doctor', 'Check local config and API readiness'],
      ['/usage', 'Fetch account usage'],
    ]],
    ['Model', [
      ['/model', 'Show the active model'],
      ['/models', 'Fetch available models from the server'],
    ]],
    ['Project', [
      ['/context', 'Show project context status'],
      ['/context on', 'Attach ~/.aillive project context in this session'],
      ['/context off', 'Detach project context in this session'],
      ['/sessions', 'Show local CLI sessions'],
    ]],
  ]
  console.log('')
  console.log(color.bold('Command Palette', useColor))
  console.log(color.gray('Type a slash command in the prompt. The request login flow only starts when an API action needs it.', useColor))
  console.log(color.gray(rule(width, '-'), useColor))
  for (const [title, commands] of groups) {
    console.log(color.bold(title, useColor))
    for (const [command, description] of commands) {
      console.log(`  ${color.cyan(command.padEnd(12), useColor)} ${description}`)
    }
    console.log('')
  }
}

function printInteractiveHome(rt = {}) {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  clearInteractiveScreen(rt)
  const width = terminalColumns()
  console.log('\n')
  const wordmark = wordmarkForWidth(width)
  const wordmarkWidth = Math.max(...wordmark.map(visibleLength))
  for (const item of wordmark) console.log(centerLine(color.bold(padEndVisual(item, wordmarkWidth), useColor), width))
  console.log('')
  console.log(centerFitLine(`${color.gray(`v${VERSION}`, useColor)} ${color.bold('( /help for commands )', useColor)}`, width))
  console.log('')
  console.log(centerFitLine(`${color.bold('Tip:', useColor)} Paste an image with Ctrl+V to attach it to your next message.`, width))
  console.log('')
  console.log(centerFitLine(color.gray('shift+tab to cycle modes  ·  ctrl+n to start a new session', useColor), width))
  console.log(centerFitLine(color.gray('/context on for project memory  ·  /login for browser auth', useColor), width))
  console.log('')
  const authState = rt.apiKey ? `${color.green('Auth', useColor)} ${color.green('ok', useColor)}` : `${color.gray('Auth', useColor)} ${color.red('x', useColor)}`
  const contextState = rt.project ? `${color.green('Context', useColor)} ${color.green('on', useColor)}` : `${color.gray('Context', useColor)} ${color.red('x', useColor)}`
  const toolsState = `${color.gray('Skills (0)', useColor)} ${color.red('x', useColor)}   ${color.gray('MCPs (0)', useColor)} ${color.red('x', useColor)}`
  console.log(centerFitLine(`${toolsState}   ${authState}   ${contextState}`, width))
  console.log('\n')
  const left = `${color.yellow(rt.project ? 'Project (Safe)' : 'Chat (Safe)', useColor)} ${color.gray('·', useColor)} ${rt.apiKey ? 'authenticated' : 'login on first request'}`
  const right = `${color.bold(rt.model || 'Server Default', useColor)} ${color.gray('[Aillive]', useColor)}`
  if (visibleLength(left) + visibleLength(right) + 5 <= width) {
    const gap = ' '.repeat(Math.max(1, width - visibleLength(left) - visibleLength(right) - 4))
    console.log(`  ${left}${gap}${right}`)
  } else {
    console.log(`  ${fitVisual(left, Math.max(1, width - 4))}`)
    console.log(`  ${fitVisual(right, Math.max(1, width - 4))}`)
  }
  console.log('')
}

export function buildHelp(enabled = true) {
  const useColor = canUseColor(enabled)
  const sections = [
    formatBox([
      `${color.bold('Aillive CLI', useColor)} ${color.dim(`v${VERSION}`, useColor)}`,
      color.dim('Terminal AI for chat, project work, APIs, and OpenClaw tasks.', useColor),
      color.dim('Install with npm, run in any project, automate with --json.', useColor),
    ], useColor),
    '',
    `${color.bold('Usage', useColor)}`,
    '  aillive                         Start interactive mode',
    '  aillive "prompt"                Send one chat request',
    '  aillive <command> [options]     Run one command',
    '',
  ]
  for (const group of COMMAND_GROUPS) {
    sections.push(color.bold(group.title, useColor))
    const width = Math.max(...group.commands.map(([name]) => name.length))
    for (const [name, description] of group.commands) {
      sections.push(`  ${color.cyan(name.padEnd(width), useColor)}  ${description}`)
    }
    sections.push('')
  }
  sections.push(color.bold('Global options', useColor))
  sections.push('  --api-key <key>     Override AILLIVE_API_KEY/config apiKey')
  sections.push('  --base-url <url>    Override AILLIVE_BASE_URL/config baseUrl')
  sections.push('  --model <model>     Override default model')
  sections.push('  --project           Include ~/.aillive project context for this request')
  sections.push('  --no-project        Disable project context even if configured')
  sections.push('  --system <prompt>   Add a one-off system instruction')
  sections.push('  --cwd <dir>         Run with a different project directory')
  sections.push('  --data-dir <dir>    Data directory for local admin maintenance commands')
  sections.push('  --open              Open local folders in the system file manager')
  sections.push('  --json              Print JSON output')
  sections.push('  --no-color          Disable ANSI colors')
  sections.push('  -h, --help          Show help')
  sections.push('  -v, --version       Show version')
  sections.push('')
  sections.push(color.bold('Examples', useColor))
  sections.push('  aillive setup')
  sections.push('  aillive chat --stream "写一个 CLI 发布 checklist"')
  sections.push('  aillive init && aillive run --project "总结这个项目"')
  sections.push('  aillive completions powershell')
  return sections.join('\n')
}

function printBrand(rt = {}, title = 'Aillive CLI') {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  console.log(color.cyan(formatBox([
    `${color.bold(title, useColor)} ${color.dim(`v${VERSION}`, useColor)}`,
    color.dim('Terminal AI for chat, APIs, OpenClaw, and project work.', useColor),
    ...(rt.baseUrl ? [color.dim(`Base URL: ${rt.baseUrl}`, useColor)] : []),
    color.dim(`Model: ${rt.model || 'server default'}`, useColor),
    color.dim(`Project context: ${rt.project ? 'on' : 'off'}`, useColor),
  ], useColor), useColor))
}

function statusMark(ok, enabled = true) {
  return ok ? color.green('OK', canUseColor(enabled)) : color.red('FAIL', canUseColor(enabled))
}

function printPanel(title, body, rt = {}) {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  console.log('')
  console.log(`${color.cyan('::', useColor)} ${color.bold(title, useColor)}`)
  console.log(color.gray(line(Math.min(64, Math.max(12, title.length))), useColor))
  if (body) console.log(body)
}

export function formatElapsed(ms) {
  const elapsedMs = Math.max(0, Number(ms) || 0)
  if (elapsedMs < 10000) {
    return `${(Math.floor(elapsedMs / 100) / 10).toFixed(1)}s`
  }
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
}

function startWorkingIndicator(rt = {}) {
  if (rt.json) return () => {}
  const useColor = canUseColor(rt.color)
  const started = Date.now()
  let stopped = false
  let renderedPlain = false
  const workingLine = () => `${color.bold('• Working', useColor)} ${color.gray(`(${formatElapsed(Date.now() - started)} · ctrl+c to interrupt)`, useColor)}`
  const render = () => {
    const lineText = workingLine()
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${lineText}\x1b[K`)
    } else if (!renderedPlain) {
      renderedPlain = true
      console.log(stripAnsi(lineText))
    }
  }
  console.log('')
  render()
  const timer = setInterval(render, 200)
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    const lineText = workingLine()
    if (process.stdout.isTTY) process.stdout.write(`\r${lineText}\x1b[K\n\n`)
    else console.log('')
  }
}

async function withSpinner(label, rt, action) {
  if (rt.json || !process.stderr.isTTY) return action()
  const frames = ['-', '\\', '|', '/']
  let index = 0
  process.stderr.write(`${frames[index]} ${label}`)
  const timer = setInterval(() => {
    index = (index + 1) % frames.length
    process.stderr.write(`\r${frames[index]} ${label}`)
  }, 90)
  try {
    return await action()
  } finally {
    clearInterval(timer)
    process.stderr.write(`\r${' '.repeat(label.length + 4)}\r`)
  }
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

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function ensureAilliveHome() {
  await ensureDir(CONFIG_DIR)
  await ensureDir(PROJECTS_DIR)
  await ensureDir(SESSIONS_DIR)
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonFile(file, data, mode = 0o600) {
  await ensureDir(path.dirname(file))
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode })
  if (process.platform !== 'win32') await fs.chmod(file, mode)
}

export async function loadConfig() {
  return readJsonFile(CONFIG_FILE, {})
}

async function saveConfig(config) {
  await writeJsonFile(CONFIG_FILE, config)
}

export async function loadAuth() {
  return readJsonFile(AUTH_FILE, {})
}

function normalizeAuthPayload(payload, fallback = {}) {
  const apiKey = String(payload?.apiKey || payload?.key || payload?.secret || payload?.token || '').trim()
  if (!apiKey) throw new Error('auth.json must include apiKey.')
  return {
    type: 'aillive_cli_auth',
    version: 1,
    apiKey,
    baseUrl: normalizeBaseUrl(payload?.baseUrl || fallback.baseUrl || DEFAULT_BASE_URL),
    profile: payload?.profile || fallback.profile || null,
    source: payload?.source || fallback.source || 'auth.json',
    createdAt: payload?.createdAt || fallback.createdAt || new Date().toISOString(),
    importedAt: new Date().toISOString(),
  }
}

async function saveAuth(payload) {
  const auth = normalizeAuthPayload(payload)
  await writeJsonFile(AUTH_FILE, auth)
  return auth
}

async function removeAuth() {
  await fs.rm(AUTH_FILE, { force: true })
}

function maskSecret(value) {
  const text = String(value || '')
  return text ? `${text.slice(0, 8)}...${text.slice(-6)}` : ''
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) throw new Error('base-url must start with http:// or https://')
  return raw
}

async function runtime(global) {
  await ensureAilliveHome()
  const config = await loadConfig()
  const auth = await loadAuth()
  const cwd = path.resolve(global.cwd || process.cwd())
  const projectSetting = global.noProject ? false : Boolean(global.project || config.projectContext === true)
  const apiKey = String(global.apiKey || process.env.AILLIVE_API_KEY || auth.apiKey || config.apiKey || '').trim()
  const authSource = global.apiKey
    ? 'argument'
    : (process.env.AILLIVE_API_KEY ? 'env' : (auth.apiKey ? 'auth.json' : (config.apiKey ? 'config-legacy' : 'missing')))
  return {
    apiKey,
    authSource,
    authFile: AUTH_FILE,
    baseUrl: normalizeBaseUrl(global.baseUrl || process.env.AILLIVE_BASE_URL || config.baseUrl || auth.baseUrl || DEFAULT_BASE_URL),
    model: String(global.model || process.env.AILLIVE_MODEL || config.model || '').trim(),
    system: String(global.system || config.system || '').trim(),
    output: String(process.env.AILLIVE_OUTPUT || config.output || '').trim(),
    json: Boolean(global.json || config.output === 'json'),
    color: Boolean(global.color),
    cwd,
    project: projectSetting,
  }
}

function apiRoot(baseUrl) {
  return baseUrl.replace(/\/v1$/i, '')
}

function projectStorageKey(cwd = process.cwd()) {
  const resolved = path.resolve(cwd)
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const slug = path.basename(resolved).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  return `${slug}-${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`
}

function projectContextDir(cwd = process.cwd()) {
  return path.join(PROJECTS_DIR, projectStorageKey(cwd))
}

function projectContextPath(cwd = process.cwd()) {
  return path.join(projectContextDir(cwd), PROJECT_CONTEXT_FILE)
}

function legacyProjectContextPath(cwd = process.cwd()) {
  return path.join(cwd, PROJECT_DIR_NAME, PROJECT_CONTEXT_FILE)
}

async function readProjectContext(rt) {
  const file = projectContextPath(rt.cwd)
  const legacyFile = legacyProjectContextPath(rt.cwd)
  if (!rt.project) return { path: file, legacyPath: legacyFile, exists: false, content: '', source: 'global' }
  try {
    const raw = await fs.readFile(file, 'utf8')
    const content = raw.trim().slice(0, MAX_PROJECT_CONTEXT_CHARS)
    return { path: file, legacyPath: legacyFile, exists: true, content, source: 'global' }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const raw = await fs.readFile(legacyFile, 'utf8')
    const content = raw.trim().slice(0, MAX_PROJECT_CONTEXT_CHARS)
    return { path: legacyFile, legacyPath: legacyFile, preferredPath: file, exists: true, content, source: 'legacy' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: file, legacyPath: legacyFile, exists: false, content: '', source: 'global' }
    throw error
  }
}

async function buildSystemContext(rt, taskMode = false) {
  const parts = []
  if (taskMode) {
    parts.push('You are Aillive CLI. Return concise, actionable output for terminal automation.')
  }
  if (rt.system) parts.push(rt.system)
  const project = await readProjectContext(rt)
  if (project.content) {
    parts.push(`Project context from ${project.path}:\n\n${project.content}`)
  }
  return { content: parts.join('\n\n'), project }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  const json = text ? safeParseJson(text) : {}
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text || `HTTP_${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.payload = json || text
    throw error
  }
  return json
}

function safeParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function authHeaders(apiKey) {
  if (!apiKey) throw new Error('Missing API key. Run `aillive auth login` or place auth.json in ~/.aillive.')
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'user-agent': `aillive-cli/${VERSION}`,
  }
}

function webOriginFromBaseUrl(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl))
  return url.origin
}

function cliAuthLoginUrl(rt) {
  const url = new URL(webOriginFromBaseUrl(rt.baseUrl))
  url.searchParams.set('cli_auth', '1')
  url.searchParams.set('client', 'aillive-cli')
  url.searchParams.set('version', VERSION)
  return url.toString()
}

function authJsonCandidates(cwd = process.cwd()) {
  return [
    AUTH_FILE,
    path.join(os.homedir(), 'Downloads', 'auth.json'),
    path.join(cwd, 'auth.json'),
  ]
}

async function importAuthJson(file, fallback = {}) {
  const raw = await fs.readFile(file, 'utf8')
  const payload = safeParseJson(raw)
  if (!payload) throw new Error(`Invalid auth.json at ${file}.`)
  return saveAuth(normalizeAuthPayload(payload, fallback))
}

async function findAndImportAuthJson(rt) {
  for (const candidate of authJsonCandidates(rt.cwd)) {
    try {
      const auth = await importAuthJson(candidate, { baseUrl: rt.baseUrl, source: candidate })
      return { auth, path: candidate }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return null
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open')
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}

function openPath(target) {
  const command = process.platform === 'win32' ? 'explorer.exe' : (process.platform === 'darwin' ? 'open' : 'xdg-open')
  const child = spawn(command, [target], { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}

async function waitForAuthJson(rt, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const imported = await findAndImportAuthJson(rt)
    if (imported) return imported
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  return null
}

async function beginWebAuthFlow(rt, { wait = true } = {}) {
  const useColor = canUseColor(rt.color)
  const loginUrl = cliAuthLoginUrl(rt)
  printAuthFlowCard(rt, loginUrl)
  try {
    openBrowser(loginUrl)
  } catch (error) {
    if (!rt.json) console.log(color.yellow(`Open this URL manually: ${loginUrl}`, useColor))
  }
  if (!wait) return null
  if (!rt.json) console.log(color.yellow('Waiting for auth.json... keep this terminal open.', useColor))
  const imported = await waitForAuthJson(rt)
  if (!imported) {
    throw new Error(`AUTH_TIMEOUT: save the downloaded auth.json to ${AUTH_FILE}, then run the command again.`)
  }
  if (!rt.json) {
    console.log(color.green(`Authenticated from ${imported.path}. You can continue in this session.`, useColor))
  }
  return imported.auth
}

async function ensureAuthForRequest(rt, reason = 'chat') {
  if (rt.apiKey) return rt
  if (!process.stdin.isTTY && !process.stdout.isTTY) {
    throw new Error(`AUTH_REQUIRED: ${reason} requires auth.json. Run aillive auth login first.`)
  }
  const auth = await beginWebAuthFlow(rt, { wait: true })
  return { ...rt, apiKey: auth.apiKey, authSource: 'auth.json', baseUrl: auth.baseUrl || rt.baseUrl }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2))
}

function printTable(rows, columns) {
  if (!rows.length) {
    console.log('No data.')
    return
  }
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => visibleLength(row[column] ?? ''))))
  console.log(columns.map((column, index) => padEndVisual(column, widths[index])).join('  '))
  console.log(columns.map((_, index) => '-'.repeat(widths[index])).join('  '))
  for (const row of rows) {
    console.log(columns.map((column, index) => padEndVisual(row[column] ?? '', widths[index])).join('  '))
  }
}

async function promptSecret(label) {
  if (!process.stdin.isTTY) throw new Error(`${label} is required in non-interactive mode.`)
  const rl = readline.createInterface({ input, output })
  try {
    return String(await rl.question(`${label}: `)).trim()
  } finally {
    rl.close()
  }
}

async function promptText(label, fallback = '') {
  if (!process.stdin.isTTY) throw new Error(`${label} is required in non-interactive mode.`)
  const rl = readline.createInterface({ input, output })
  try {
    const suffix = fallback ? ` (${fallback})` : ''
    const value = String(await rl.question(`${label}${suffix}: `)).trim()
    return value || fallback
  } finally {
    rl.close()
  }
}

async function cmdAuth(parsed) {
  const action = parsed.subcommand || 'status'
  const config = await loadConfig()
  if (action === 'login') {
    const rt = await runtime(parsed.global)
    if (parsed.global.apiKey) {
      const auth = await saveAuth({ apiKey: parsed.global.apiKey, baseUrl: rt.baseUrl, source: 'argument' })
      if (parsed.global.baseUrl) config.baseUrl = normalizeBaseUrl(parsed.global.baseUrl)
      delete config.apiKey
      await saveConfig(config)
      if (rt.json) return printJson({ ok: true, authFile: AUTH_FILE, source: auth.source, apiKey: maskSecret(auth.apiKey) })
      printBrand({ ...rt, apiKey: auth.apiKey, authSource: 'auth.json' }, 'Aillive Login')
      printPanel('Saved', `auth.json saved to ${AUTH_FILE}.\nRun \`aillive doctor\` to verify the connection.`, rt)
      return
    }
    if (parsed.global.baseUrl) config.baseUrl = normalizeBaseUrl(parsed.global.baseUrl)
    await saveConfig(config)
    const auth = await beginWebAuthFlow(rt, { wait: true })
    if (rt.json) return printJson({ ok: true, authFile: AUTH_FILE, apiKey: maskSecret(auth.apiKey), baseUrl: auth.baseUrl })
    printPanel('Saved', `auth.json saved to ${AUTH_FILE}.\nRun \`aillive doctor\` to verify the connection.`, rt)
    return
  }
  if (action === 'import') {
    const rt = await runtime(parsed.global)
    const file = parsed.rest[0] ? path.resolve(rt.cwd, parsed.rest[0]) : path.join(rt.cwd, 'auth.json')
    const auth = await importAuthJson(file, { baseUrl: rt.baseUrl, source: file })
    if (parsed.global.baseUrl) config.baseUrl = normalizeBaseUrl(parsed.global.baseUrl)
    delete config.apiKey
    await saveConfig(config)
    if (rt.json) return printJson({ ok: true, authFile: AUTH_FILE, importedFrom: file, apiKey: maskSecret(auth.apiKey), baseUrl: auth.baseUrl })
    printBrand({ ...rt, apiKey: auth.apiKey, authSource: 'auth.json' }, 'Aillive Auth')
    printPanel('Imported', `Imported ${file}\nSaved ${AUTH_FILE}`, rt)
    return
  }
  if (action === 'path') {
    console.log(AUTH_FILE)
    return
  }
  if (action === 'logout') {
    delete config.apiKey
    await removeAuth()
    await saveConfig(config)
    const rt = await runtime(parsed.global)
    printBrand(rt, 'Aillive Logout')
    printPanel('Done', `Local auth removed from ${AUTH_FILE}.`, rt)
    return
  }
  if (action === 'status') {
    const rt = await runtime(parsed.global)
    const auth = await loadAuth()
    const payload = {
      authenticated: Boolean(rt.apiKey),
      baseUrl: rt.baseUrl,
      model: rt.model || '(server default)',
      configFile: CONFIG_FILE,
      authFile: AUTH_FILE,
      source: rt.authSource,
      authJson: Boolean(auth.apiKey),
    }
    if (parsed.global.json) return printJson(payload)
    printBrand(rt, 'Aillive Auth')
    return printTable([{ ...payload, authenticated: payload.authenticated ? 'yes' : 'no' }], ['authenticated', 'baseUrl', 'model', 'source', 'authFile'])
  }
  throw new Error(`Unknown auth command: ${action}`)
}

async function cmdSetup(parsed) {
  const rt = await runtime(parsed.global)
  printBrand(rt, 'Aillive Setup')
  printPanel('Local Profile', 'This wizard writes ~/.aillive/config.json for terminal use.\nSecrets stay on this machine and are not added to your project.', rt)
  const baseUrl = normalizeBaseUrl(await promptText('Base URL', rt.baseUrl))
  const model = await promptText('Default model', rt.model || 'server default')
  const apiKey = parsed.global.apiKey || await promptSecret('Aillive API key')
  const config = await loadConfig()
  config.baseUrl = baseUrl
  delete config.apiKey
  if (model && model !== 'server default') config.model = model
  await saveConfig(config)
  await saveAuth({ apiKey, baseUrl, source: 'setup' })
  printPanel('Next Steps', formatCommandBlock([
    'aillive doctor',
    'aillive chat --stream "Hello Aillive"',
    'aillive init',
    'aillive run --project "Summarize this project"',
  ]), rt)
}

async function cmdConfig(parsed) {
  const action = parsed.subcommand || 'list'
  const config = await loadConfig()
  if (action === 'set') {
    const [key, ...valueParts] = parsed.rest
    const value = valueParts.join(' ').trim()
    const map = { 'api-key': 'apiKey', 'base-url': 'baseUrl', model: 'model', output: 'output', 'project-context': 'projectContext', system: 'system' }
    const configKey = map[key] || key
    if (!['apiKey', 'baseUrl', 'model', 'output', 'projectContext', 'system'].includes(configKey) || !value) {
      throw new Error('Usage: aillive config set api-key|base-url|model|output|project-context|system <value>')
    }
    if (configKey === 'apiKey') {
      const rt = await runtime(parsed.global)
      const auth = await saveAuth({ apiKey: value, baseUrl: rt.baseUrl, source: 'config set api-key' })
      delete config.apiKey
      await saveConfig(config)
      console.log(`auth.json saved to ${AUTH_FILE} (${maskSecret(auth.apiKey)}).`)
      return
    }
    config[configKey] = configKey === 'baseUrl'
      ? normalizeBaseUrl(value)
      : (configKey === 'projectContext' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value)
    await saveConfig(config)
    console.log(`${configKey} saved.`)
    return
  }
  if (action === 'get') {
    const key = parsed.rest[0]
    if (!key) throw new Error('Usage: aillive config get <key>')
    const map = { 'api-key': 'apiKey', 'base-url': 'baseUrl', 'project-context': 'projectContext' }
    const value = config[map[key] || key] || ''
    console.log(String(value))
    return
  }
  if (action === 'list') {
    const auth = await loadAuth()
    const masked = {
      ...config,
      apiKey: auth.apiKey ? maskSecret(auth.apiKey) : (config.apiKey ? `${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-6)}` : ''),
      authFile: AUTH_FILE,
    }
    if (parsed.global.json) return printJson(masked)
    const rt = await runtime(parsed.global)
    printBrand(rt, 'Aillive Config')
    return printTable([masked], Object.keys(masked).length ? Object.keys(masked) : ['apiKey', 'baseUrl', 'model'])
  }
  throw new Error(`Unknown config command: ${action}`)
}

async function cmdModels(parsed) {
  const rt = await ensureAuthForRequest(await runtime(parsed.global), 'models')
  const data = await withSpinner('Loading models...', rt, () => requestJson(`${rt.baseUrl}/models`, { headers: authHeaders(rt.apiKey) }))
  const rows = (data.data || []).map((model) => ({
    id: model.id,
    label: model.label || '',
    owned_by: model.owned_by || '',
  }))
  if (rt.json) return printJson(data)
  printBrand(rt, 'Aillive Models')
  return printTable(rows, ['id', 'label', 'owned_by'])
}

function promptFrom(parsed, fallbackName) {
  const value = parsed.args.join(' ').trim()
  if (!value) throw new Error(`Usage: aillive ${fallbackName} "your prompt"`)
  return value
}

async function chatPayload(parsed, taskMode = false) {
  const rt = await runtime(parsed.global)
  const prompt = promptFrom(parsed, taskMode ? 'run' : 'chat')
  const system = await buildSystemContext(rt, taskMode)
  const messages = [
    ...(system.content ? [{ role: 'system', content: system.content }] : []),
    { role: 'user', content: prompt },
  ]
  return { rt, prompt, project: system.project, body: { model: rt.model || undefined, messages, stream: parsed.global.stream } }
}

async function cmdChat(parsed, taskMode = false) {
  const payload = await chatPayload(parsed, taskMode)
  let { rt, prompt, project, body } = payload
  rt = await ensureAuthForRequest(rt, taskMode ? 'run' : 'chat')
  const started = Date.now()
  let content = ''
  if (!rt.json) {
    printBrand(rt, taskMode ? 'Aillive Run' : 'Aillive Chat')
    if (rt.project) {
      const displayPath = project.source === 'legacy'
        ? path.relative(rt.cwd, project.path)
        : project.path
      printPanel('Project Context', project.exists
        ? `Loaded ${displayPath} (${project.content.length} chars).`
        : `Not found at ${project.path}. Run \`aillive init\` first.`, rt)
    }
    printPanel('User', prompt, rt)
  }
  if (parsed.global.stream) {
    if (!rt.json) printPanel('Aillive', '', rt)
    content = await streamChat(rt, body)
  } else {
    const data = await withSpinner('Thinking...', rt, () => requestJson(`${rt.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(rt.apiKey),
      body: JSON.stringify(body),
    }))
    content = extractContent(data)
    rt.json ? printJson(data) : printPanel('Aillive', content || '(empty response)', rt)
  }
  await recordSession(taskMode ? 'run' : 'chat', prompt, content)
  await recordStats(taskMode ? 'run' : 'chat', Date.now() - started, true)
}

async function streamChat(rt, body, options = {}) {
  let firstOutput = false
  const markOutput = () => {
    if (firstOutput) return
    firstOutput = true
    if (typeof options.onFirstOutput === 'function') options.onFirstOutput()
  }
  const response = await fetch(`${rt.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(rt.apiKey),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(safeParseJson(text)?.error?.message || text || `HTTP_${response.status}`)
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const parts = buffer.split(/\n\n|\n/)
    buffer = parts.pop() || ''
    for (const part of parts) {
      const text = part.replace(/^data:\s*/gm, '').trim()
      if (!text || text === '[DONE]') continue
      const json = safeParseJson(text)
      if (json?.type === 'error') throw new Error(json.message || 'STREAM_ERROR')
      if (json?.type === 'replace_content' && json.content) {
        markOutput()
        if (content) process.stdout.write('\n')
        content = String(json.content)
        process.stdout.write(content)
        continue
      }
      const delta = json?.delta || json?.content || json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || ''
      if (delta) {
        markOutput()
        content += delta
        process.stdout.write(delta)
      }
    }
  }
  if (!firstOutput && typeof options.onFirstOutput === 'function') options.onFirstOutput()
  if (content) process.stdout.write('\n')
  return content
}

function extractContent(data) {
  return data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.content
    || data?.response
    || ''
}

async function cmdInit(parsed) {
  const rt = await runtime(parsed.global)
  const dir = projectContextDir(rt.cwd)
  const file = path.join(dir, PROJECT_CONTEXT_FILE)
  await ensureDir(dir)
  if (!parsed.global.force) {
    try {
      await fs.access(file)
      console.log(`${file} already exists. Use --force to overwrite.`)
      return
    } catch {}
  }
  const body = [
    '# Aillive Project Context',
    '',
    `Created: ${new Date().toISOString()}`,
    `Root: ${rt.cwd}`,
    '',
    'This file is optional project context for Aillive CLI.',
    'It is stored under your home ~/.aillive directory and is only sent when you pass `--project` or enable `config set project-context true`.',
    '',
    '## Purpose',
    '',
    '- Describe what this project does.',
    '- Name the primary users and the product boundaries.',
    '',
    '## Tech Stack',
    '',
    '- Frontend:',
    '- Backend:',
    '- Database:',
    '- Deployment:',
    '',
    '## Commands',
    '',
    '- Install:',
    '- Build:',
    '- Test:',
    '- Start:',
    '',
    '## Working Rules',
    '',
    '- Keep secrets, API keys, local databases, and logs out of Git.',
    '- Prefer focused changes and run the smallest meaningful verification command.',
    '- Keep frontend visual style consistent with the existing product unless explicitly requested.',
    '',
  ].join('\n')
  await fs.writeFile(file, body, 'utf8')
  console.log(`Created ${file}`)
}

async function cmdContext(parsed) {
  const action = parsed.subcommand || 'status'
  const rt = await runtime(parsed.global)
  const file = projectContextPath(rt.cwd)
  const legacyFile = legacyProjectContextPath(rt.cwd)
  if (action === 'path') {
    console.log(file)
    return
  }
  if (action === 'init') return cmdInit(parsed)
  const context = await readProjectContext({ ...rt, project: true })
  const content = context.content || ''
  const exists = context.exists
  if (action === 'show') {
    if (!exists) throw new Error(`Project context not found. Run \`aillive init\` in ${rt.cwd}.`)
    console.log(content.trimEnd())
    return
  }
  if (action === 'status') {
    const payload = {
      cwd: rt.cwd,
      path: file,
      legacyPath: legacyFile,
      exists,
      source: context.source || 'global',
      enabled: rt.project,
      chars: exists ? content.length : 0,
    }
    if (rt.json) return printJson(payload)
    printBrand(rt, 'Aillive Context')
    printTable([{
      item: 'project context',
      state: exists ? statusMark(true, rt.color) : statusMark(false, rt.color),
      detail: exists ? `${content.length} chars at ${context.path}` : `missing at ${file}`,
    }, {
      item: 'legacy fallback',
      state: context.source === 'legacy' ? color.yellow('USED', canUseColor(rt.color)) : color.gray('READY', canUseColor(rt.color)),
      detail: legacyFile,
    }, {
      item: 'send mode',
      state: rt.project ? statusMark(true, rt.color) : color.gray('OFF', canUseColor(rt.color)),
      detail: rt.project ? 'enabled for this run' : 'use --project or config set project-context true',
    }], ['item', 'state', 'detail'])
    return
  }
  throw new Error('Usage: aillive context status|show|path|init')
}

async function readSessions() {
  return readJsonFile(SESSIONS_FILE, { sessions: [] })
}

async function recordSession(type, prompt, content) {
  const data = await readSessions()
  data.sessions.unshift({
    id: `ses_${Date.now().toString(36)}`,
    type,
    prompt,
    content,
    createdAt: new Date().toISOString(),
  })
  data.sessions = data.sessions.slice(0, 50)
  await writeJsonFile(SESSIONS_FILE, data)
}

async function cmdSession(parsed) {
  const action = parsed.subcommand || 'list'
  const data = await readSessions()
  if (action === 'list') {
    const rows = data.sessions.map((item) => ({
      id: item.id,
      type: item.type,
      createdAt: item.createdAt,
      prompt: String(item.prompt || '').slice(0, 60),
    }))
    return parsed.global.json ? printJson(data) : printTable(rows, ['id', 'type', 'createdAt', 'prompt'])
  }
  if (action === 'resume') {
    const id = parsed.rest[0]
    const session = data.sessions.find((item) => item.id === id)
    if (!session) throw new Error('Session not found.')
    return parsed.global.json ? printJson(session) : console.log(session.content || session.prompt)
  }
  if (action === 'clear') {
    await writeJsonFile(SESSIONS_FILE, { sessions: [] })
    console.log('Local sessions cleared.')
    return
  }
  throw new Error(`Unknown session command: ${action}`)
}

async function readStats() {
  return readJsonFile(STATS_FILE, { total: 0, ok: 0, failed: 0, commands: {}, lastUsedAt: '' })
}

async function recordStats(command, latencyMs, ok) {
  const data = await readStats()
  data.total += 1
  data[ok ? 'ok' : 'failed'] += 1
  data.lastUsedAt = new Date().toISOString()
  data.commands[command] = data.commands[command] || { total: 0, ok: 0, failed: 0, latencyMs: 0 }
  data.commands[command].total += 1
  data.commands[command][ok ? 'ok' : 'failed'] += 1
  data.commands[command].latencyMs += Number(latencyMs || 0)
  await writeJsonFile(STATS_FILE, data)
}

async function cmdStats(parsed) {
  const data = await readStats()
  if (parsed.global.json) return printJson(data)
  const rt = await runtime(parsed.global)
  printBrand(rt, 'Aillive Stats')
  console.log(`Total commands: ${data.total}  OK: ${data.ok}  Failed: ${data.failed}`)
  console.log(`Last used: ${data.lastUsedAt || 'never'}`)
  const rows = Object.entries(data.commands || {}).map(([command, item]) => ({
    command,
    total: item.total || 0,
    ok: item.ok || 0,
    failed: item.failed || 0,
    avgMs: item.total ? Math.round((item.latencyMs || 0) / item.total) : 0,
  }))
  if (rows.length) printTable(rows, ['command', 'total', 'ok', 'failed', 'avgMs'])
}

async function cmdHome(parsed) {
  const rt = await runtime(parsed.global)
  const shouldOpen = parsed.global.open || parsed.subcommand === 'open'
  const payload = {
    home: CONFIG_DIR,
    authFile: AUTH_FILE,
    configFile: CONFIG_FILE,
    statsFile: STATS_FILE,
    sessionsDir: SESSIONS_DIR,
    projectsDir: PROJECTS_DIR,
    files: {
      auth: await exists(AUTH_FILE),
      config: await exists(CONFIG_FILE),
      stats: await exists(STATS_FILE),
      sessions: await exists(SESSIONS_DIR),
      projects: await exists(PROJECTS_DIR),
    },
    opened: false,
  }
  if (shouldOpen) {
    openPath(CONFIG_DIR)
    payload.opened = true
  }
  if (rt.json) return printJson(payload)
  printBrand(rt, 'Aillive Home')
  printTable([
    { item: 'home', state: statusMark(true, rt.color), detail: payload.home },
    { item: 'auth.json', state: payload.files.auth ? statusMark(true, rt.color) : color.gray('PENDING', canUseColor(rt.color)), detail: payload.authFile },
    { item: 'config.json', state: payload.files.config ? statusMark(true, rt.color) : color.gray('PENDING', canUseColor(rt.color)), detail: payload.configFile },
    { item: 'sessions', state: statusMark(payload.files.sessions, rt.color), detail: payload.sessionsDir },
    { item: 'projects', state: statusMark(payload.files.projects, rt.color), detail: payload.projectsDir },
  ], ['item', 'state', 'detail'])
  printPanel('Tip', [
    'On Windows, dot folders can be hard to spot in Explorer.',
    'Run `aillive home --open` or paste the home path into the Explorer address bar.',
  ].join('\n'), rt)
  if (payload.opened) printPanel('Opened', payload.home, rt)
}

async function cmdStatus(parsed) {
  const rt = await runtime(parsed.global)
  const sessions = await readSessions()
  const stats = await readStats()
  const contextFile = projectContextPath(rt.cwd)
  const contextStatus = await readProjectContext({ ...rt, project: true })
  const contextExists = contextStatus.exists
  const payload = {
    authenticated: Boolean(rt.apiKey),
    apiKeySource: rt.authSource,
    home: CONFIG_DIR,
    baseUrl: rt.baseUrl,
    model: rt.model || '(server default)',
    cwd: rt.cwd,
    projectContext: {
      enabled: rt.project,
      exists: contextExists,
      path: contextStatus.path || contextFile,
      source: contextStatus.source || 'global',
      preferredPath: contextFile,
    },
    sessions: sessions.sessions?.length || 0,
    stats: {
      total: stats.total || 0,
      failed: stats.failed || 0,
      lastUsedAt: stats.lastUsedAt || '',
    },
  }
  if (rt.json) return printJson(payload)
  printBrand(rt, 'Aillive Status')
  printTable([
    { item: 'auth', state: payload.authenticated ? statusMark(true, rt.color) : color.yellow('MISSING', canUseColor(rt.color)), detail: payload.apiKeySource },
    { item: 'home', state: statusMark(true, rt.color), detail: payload.home },
    { item: 'baseUrl', state: statusMark(true, rt.color), detail: payload.baseUrl },
    { item: 'model', state: payload.model === '(server default)' ? color.gray('DEFAULT', canUseColor(rt.color)) : statusMark(true, rt.color), detail: payload.model },
    { item: 'project', state: contextExists ? statusMark(true, rt.color) : color.gray('NONE', canUseColor(rt.color)), detail: `${payload.projectContext.path}${rt.project ? ' (enabled)' : ' (off)'}` },
    { item: 'sessions', state: statusMark(true, rt.color), detail: String(payload.sessions) },
    { item: 'local stats', state: statusMark(true, rt.color), detail: `${payload.stats.total} commands, ${payload.stats.failed} failed` },
  ], ['item', 'state', 'detail'])
  console.log('')
  console.log(payload.authenticated
    ? color.green('Ready. Try `aillive chat --stream "Hello"`.', canUseColor(rt.color))
    : color.yellow('Next: run `aillive auth login`, `aillive setup`, or set AILLIVE_API_KEY.', canUseColor(rt.color)))
}

export function generateCompletion(shell = 'powershell') {
  const commands = TOP_LEVEL_COMMANDS.join(' ')
  if (shell === 'bash') {
    return [
      '_aillive_complete() {',
      '  local cur="${COMP_WORDS[COMP_CWORD]}"',
      `  COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )`,
      '}',
      'complete -F _aillive_complete aillive',
    ].join('\n')
  }
  if (shell === 'zsh') {
    return [
      '#compdef aillive',
      `local -a commands`,
      `commands=(${TOP_LEVEL_COMMANDS.map((name) => `'${name}'`).join(' ')})`,
      '_describe "aillive command" commands',
    ].join('\n')
  }
  if (shell === 'powershell' || shell === 'pwsh') {
    const quoted = TOP_LEVEL_COMMANDS.map((name) => `'${name}'`).join(', ')
    return [
      'Register-ArgumentCompleter -Native -CommandName aillive -ScriptBlock {',
      '  param($wordToComplete)',
      `  $commands = @(${quoted})`,
      '  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
      "    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
      '  }',
      '}',
    ].join('\n')
  }
  throw new Error('Usage: aillive completions powershell|bash|zsh')
}

async function cmdCompletions(parsed) {
  const shell = parsed.subcommand || 'powershell'
  console.log(generateCompletion(shell))
}

async function cmdOpenClaw(parsed) {
  const action = parsed.subcommand || ''
  if (action !== 'run') throw new Error('Usage: aillive openclaw run "task"')
  const rt = await ensureAuthForRequest(await runtime(parsed.global), 'openclaw')
  const task = parsed.rest.join(' ').trim()
  if (!task) throw new Error('Usage: aillive openclaw run "task"')
  if (!rt.json) {
    printBrand(rt, 'Aillive OpenClaw')
    printPanel('Task', task, rt)
  }
  const data = await withSpinner('Running OpenClaw task...', rt, () => requestJson(`${apiRoot(rt.baseUrl)}/openclaw/v1/tasks`, {
    method: 'POST',
    headers: authHeaders(rt.apiKey),
    body: JSON.stringify({ task, model: rt.model || undefined }),
  }))
  await recordStats('openclaw', 0, true)
  return rt.json ? printJson(data) : printPanel('Result', extractContent(data.response) || data.task?.result || JSON.stringify(data, null, 2), rt)
}

async function cmdUsage(parsed) {
  const rt = await ensureAuthForRequest(await runtime(parsed.global), 'usage')
  const params = new URLSearchParams()
  if (parsed.global.from) params.set('from', parsed.global.from)
  if (parsed.global.to) params.set('to', parsed.global.to)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const data = await withSpinner('Loading usage...', rt, () => requestJson(`${rt.baseUrl}/usage${suffix}`, { headers: authHeaders(rt.apiKey) }))
  if (rt.json) return printJson(data)
  printBrand(rt, 'Aillive Usage')
  const usage = data.usage || {}
  return printTable([{
    chat: usage.chatRequests || 0,
    api: usage.apiRequests || 0,
    openclaw: usage.automationTasks || 0,
    keys: usage.apiKeys || 0,
    lastUsedAt: usage.lastUsedAt || '',
  }], ['chat', 'api', 'openclaw', 'keys', 'lastUsedAt'])
}

async function cmdDoctor(parsed) {
  const rt = await runtime(parsed.global)
  const checks = []
  checks.push({ check: 'node', ok: Number(process.versions.node.split('.')[0]) >= 18, detail: process.version })
  checks.push({ check: 'config', ok: Boolean(rt.baseUrl), detail: rt.baseUrl })
  checks.push({ check: 'apiKey', ok: Boolean(rt.apiKey), detail: rt.apiKey ? 'configured' : 'missing' })
  if (rt.apiKey) {
    try {
      const data = await requestJson(`${rt.baseUrl}/models`, { headers: authHeaders(rt.apiKey) })
      checks.push({ check: 'models', ok: true, detail: `${data.data?.length || 0} models` })
    } catch (error) {
      checks.push({ check: 'models', ok: false, detail: error.message })
    }
  }
  const failed = checks.some((item) => !item.ok)
  if (rt.json) printJson({ ok: !failed, checks })
  else {
    printBrand(rt, 'Aillive Doctor')
    printTable(checks.map((item) => ({ ...item, ok: statusMark(item.ok, rt.color) })), ['check', 'ok', 'detail'])
    console.log('')
    console.log(failed
      ? color.yellow('Next: run `aillive setup` or set AILLIVE_API_KEY.', canUseColor(rt.color))
      : color.green('Ready for terminal AI work.', canUseColor(rt.color)))
  }
  if (failed) process.exitCode = 1
}

async function cmdInteractive(parsed) {
  const rt = await runtime(parsed.global)
  const sessionRt = { ...rt }
  printInteractiveHome(sessionRt)
  const rl = readline.createInterface({ input, output })
  const messages = []
  try {
    while (true) {
      let prompt = ''
      try {
        prompt = String(await rl.question(interactivePrompt(sessionRt))).trim()
        resetPromptStyle(sessionRt)
      } catch (error) {
        resetPromptStyle(sessionRt)
        if (error?.code === 'ERR_USE_AFTER_CLOSE') break
        throw error
      }
      if (!prompt) continue
      if (['/exit', '/quit', 'exit', 'quit'].includes(prompt.toLowerCase())) break
      if (prompt === '/help') {
        printInteractiveHelp(sessionRt)
        continue
      }
      if (prompt === '/status') {
        await cmdStatus({ ...parsed, command: 'status', args: [], rest: [] })
        continue
      }
      if (prompt === '/login') {
        const auth = await beginWebAuthFlow(sessionRt, { wait: true })
        sessionRt.apiKey = auth.apiKey
        sessionRt.baseUrl = auth.baseUrl || sessionRt.baseUrl
        sessionRt.authSource = 'auth.json'
        continue
      }
      if (prompt === '/model') {
        console.log(sessionRt.model || '(server default)')
        continue
      }
      if (prompt === '/models') {
        await cmdModels({ ...parsed, command: 'models', args: [], rest: [] })
        continue
      }
      if (prompt === '/context') {
        await cmdContext({ ...parsed, command: 'context', subcommand: 'status', args: ['status'], rest: [] })
        continue
      }
      if (prompt === '/context on') {
        sessionRt.project = true
        parsed.global.project = true
        parsed.global.noProject = false
        console.log('Project context enabled for this terminal session.')
        continue
      }
      if (prompt === '/context off') {
        sessionRt.project = false
        parsed.global.project = false
        parsed.global.noProject = true
        console.log('Project context disabled for this terminal session.')
        continue
      }
      if (prompt === '/usage') {
        await cmdUsage({ ...parsed, command: 'usage', args: [], rest: [] })
        continue
      }
      if (prompt === '/doctor') {
        await cmdDoctor({ ...parsed, command: 'doctor', args: [], rest: [] })
        continue
      }
      if (prompt === '/sessions') {
        await cmdSession({ ...parsed, command: 'session', subcommand: 'list', args: ['list'], rest: [] })
        continue
      }
      if (prompt === '/clear') {
        messages.length = 0
        console.log('Conversation cleared.')
        continue
      }
      messages.push({ role: 'user', content: prompt })
      if (!sessionRt.apiKey) {
        const auth = await beginWebAuthFlow(sessionRt, { wait: true })
        sessionRt.apiKey = auth.apiKey
        sessionRt.baseUrl = auth.baseUrl || sessionRt.baseUrl
        sessionRt.authSource = 'auth.json'
      }
      const system = await buildSystemContext(sessionRt, false)
      let stopWorking = startWorkingIndicator(sessionRt)
      let content = ''
      try {
        content = await streamChat(sessionRt, {
          model: sessionRt.model || undefined,
          messages: [
            ...(system.content ? [{ role: 'system', content: system.content }] : []),
            ...messages.slice(-12),
          ],
          stream: true,
        }, {
          onFirstOutput: () => {
            stopWorking()
            stopWorking = () => {}
          },
        })
      } finally {
        stopWorking()
      }
      if (content) messages.push({ role: 'assistant', content })
      await recordSession('interactive', prompt, content)
      await recordStats('interactive', 0, true)
    }
  } finally {
    rl.close()
  }
}

async function cmdInstall(parsed) {
  const rt = await runtime(parsed.global)
  printBrand(rt, 'Aillive Install')
  printPanel('Install From npm', formatCommandBlock([
    'npm install -g @aillive/cli',
    'aillive --version',
    'aillive setup',
    'aillive doctor',
    'aillive',
  ]), rt)
  printPanel('Install From This Folder', formatCommandBlock([
    'cd "Aillive CLI"',
    'npm install -g .',
    'aillive --help',
  ]), rt)
  printPanel('One-shot npx', formatCommandBlock([
    'npx @aillive/cli chat "Hello Aillive"',
    'npx @aillive/cli run --project "Summarize this project"',
  ]), rt)
  printPanel('Environment Variables', [
    'PowerShell:',
    '  $env:AILLIVE_API_KEY="ail_xxx"',
    '  $env:AILLIVE_BASE_URL="https://www.aillive.xyz/api/v1"',
    '',
    'bash/zsh:',
    '  export AILLIVE_API_KEY="ail_xxx"',
    '  export AILLIVE_BASE_URL="https://www.aillive.xyz/api/v1"',
  ].join('\n'), rt)
  printPanel('Shell Completion', formatCommandBlock([
    'aillive completions powershell',
    'aillive completions bash',
    'aillive completions zsh',
  ]), rt)
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function maskEmail(value) {
  const email = normalizeEmail(value)
  const [name, domain] = email.split('@')
  if (!name || !domain) return email
  return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function resolveDataDir(global = {}) {
  const cwd = path.resolve(global.cwd || process.cwd())
  const explicit = global.dataDir || process.env.AILLIVE_DATA_DIR || process.env.DATA_DIR
  if (explicit) return path.resolve(cwd, explicit)
  const candidates = [
    path.join(cwd, 'Web', 'data'),
    path.join(cwd, 'data'),
  ]
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'store.json'))) return candidate
  }
  return candidates[0]
}

async function readStoreFile(dataDir) {
  const storePath = path.join(dataDir, 'store.json')
  let raw = ''
  try {
    raw = await fs.readFile(storePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Aillive store not found at ${storePath}. Pass --data-dir or register a user first.`)
    }
    throw error
  }
  const store = safeParseJson(raw)
  if (!store || !Array.isArray(store.users)) {
    throw new Error(`Invalid Aillive store at ${storePath}.`)
  }
  return { store, storePath }
}

async function writeStoreFile(storePath, store) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${storePath}.backup-${stamp}`
  const tmpPath = `${storePath}.tmp-${process.pid}`
  await fs.copyFile(storePath, backupPath)
  store.updatedAt = new Date().toISOString()
  await fs.writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await fs.rename(tmpPath, storePath)
  return backupPath
}

async function writeCliAdminAudit(dataDir, user, previousRole) {
  const dbPath = path.join(dataDir, 'aillive.sqlite')
  if (!(await exists(dbPath))) return { written: false, reason: 'sqlite_missing' }
  let sqlite
  try {
    sqlite = await import('node:sqlite')
  } catch (error) {
    return { written: false, reason: `node_sqlite_unavailable:${error.message}` }
  }
  let db
  try {
    db = new sqlite.DatabaseSync(dbPath)
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'").get()
    if (!table) return { written: false, reason: 'audit_logs_missing' }
    db.prepare(`
      INSERT INTO audit_logs
        (id, action, actor_user_id, actor_type, target_type, target_id, request_id, ip_hash, user_agent, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      'admin.user.promoted',
      '',
      'cli',
      'user',
      String(user.id || ''),
      '',
      '',
      `aillive-cli/${VERSION}`,
      JSON.stringify({
        emailMasked: maskEmail(user.email),
        emailHash: sha256(normalizeEmail(user.email)),
        previousRole: previousRole || 'user',
        role: 'admin',
        source: 'aillive admin promote',
      }),
      new Date().toISOString(),
    )
    return { written: true, path: dbPath }
  } catch (error) {
    return { written: false, reason: error.message }
  } finally {
    try {
      db?.close()
    } catch {}
  }
}

async function cmdAdmin(parsed) {
  const action = parsed.subcommand || ''
  if (action !== 'promote') {
    throw new Error('Usage: aillive admin promote <email> --data-dir <path-to-Web/data>')
  }
  const email = normalizeEmail(parsed.rest[0])
  if (!isValidEmail(email)) {
    throw new Error('Usage: aillive admin promote <email> --data-dir <path-to-Web/data>')
  }
  const rt = await runtime(parsed.global)
  const dataDir = await resolveDataDir(parsed.global)
  const { store, storePath } = await readStoreFile(dataDir)
  const user = store.users.find((item) => normalizeEmail(item.email) === email)
  if (!user) {
    throw new Error(`User ${email} not found in ${storePath}. Register the user first, then run this command again.`)
  }
  const previousRole = String(user.role || 'user')
  const alreadyAdmin = previousRole === 'admin'
  let backupPath = ''
  let audit = { written: false, reason: alreadyAdmin ? 'already_admin' : 'not_attempted' }
  if (!alreadyAdmin) {
    user.role = 'admin'
    backupPath = await writeStoreFile(storePath, store)
    audit = await writeCliAdminAudit(dataDir, user, previousRole)
  }
  const payload = {
    ok: true,
    changed: !alreadyAdmin,
    email,
    userId: user.id || '',
    previousRole,
    role: 'admin',
    dataDir,
    storePath,
    backupPath,
    audit,
  }
  if (rt.json) return printJson(payload)
  printBrand(rt, 'Aillive Admin')
  printTable([{
    email: maskEmail(email),
    userId: user.id || '',
    changed: payload.changed ? 'yes' : 'no',
    role: 'admin',
  }], ['email', 'userId', 'changed', 'role'])
  printPanel('Files', [
    `Store: ${storePath}`,
    backupPath ? `Backup: ${backupPath}` : 'Backup: not needed',
    audit.written ? `Audit: ${audit.path}` : `Audit: ${audit.reason}`,
  ].join('\n'), rt)
}

async function dispatch(parsed) {
  if (parsed.global.version) {
    console.log(VERSION)
    return
  }
  if (parsed.global.help) {
    console.log(buildHelp(parsed.global.color))
    return
  }
  if (!parsed.command) {
    if (process.stdin.isTTY && process.stdout.isTTY) return cmdInteractive(parsed)
    console.log(buildHelp(parsed.global.color))
    return
  }
  switch (parsed.command) {
    case 'setup': return cmdSetup(parsed)
    case 'install': return cmdInstall(parsed)
    case 'interactive': return cmdInteractive(parsed)
    case 'login': return cmdAuth({ ...parsed, command: 'auth', subcommand: 'login', args: ['login'], rest: [] })
    case 'logout': return cmdAuth({ ...parsed, command: 'auth', subcommand: 'logout', args: ['logout'], rest: [] })
    case 'status': return cmdStatus(parsed)
    case 'home': return cmdHome(parsed)
    case 'auth': return cmdAuth(parsed)
    case 'config': return cmdConfig(parsed)
    case 'models': return cmdModels(parsed)
    case 'ask': return cmdChat(parsed, false)
    case 'chat': return cmdChat(parsed, false)
    case 'run': return cmdChat(parsed, true)
    case 'init': return cmdInit(parsed)
    case 'context': return cmdContext(parsed)
    case 'session': return cmdSession(parsed)
    case 'stats': return cmdStats(parsed)
    case 'openclaw': return cmdOpenClaw(parsed)
    case 'usage': return cmdUsage(parsed)
    case 'admin': return cmdAdmin(parsed)
    case 'doctor': return cmdDoctor(parsed)
    case 'completions': return cmdCompletions(parsed)
    case 'upgrade':
      console.log('npm install -g @aillive/cli@latest')
      return
    default:
      return cmdChat({
        ...parsed,
        command: 'chat',
        args: [parsed.command, ...parsed.args],
        rest: parsed.args,
      }, false)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgv(argv)
  try {
    await dispatch(parsed)
  } catch (error) {
    const enabled = parsed.global?.color !== false
    console.error(color.red(`Error: ${error.message}`, enabled))
    process.exitCode = Number(error.status || 1) === 1 ? 1 : 1
    try {
      await recordStats(parsed.command || 'unknown', 0, false)
    } catch {}
  }
}

if (process.env.AILLIVE_CLI_IMPORT_ONLY !== '1') {
  main()
}
