#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  DEFAULT_BASE_URL,
  MAX_PROJECT_CONTEXT_CHARS,
  PROJECT_CONTEXT_FILE,
  PROJECT_DIR_NAME,
  VERSION,
  ensureDir,
  errorToJson,
  maskSecret,
  normalizeBaseUrl,
  parseArgv,
  readJsonFile,
  resolveAillivePaths,
  safeParseJson,
  writeJsonFile,
} from '../../../packages/core/src/index.js'
import {
  defaultVerificationCommands,
  getRuntimeStatus,
  planAgentTask,
  resumeAgentRun,
  runCommandVerifications,
  runAgentTask,
} from '../../../packages/agent-runtime/src/index.js'
import {
  checkProviderStatus,
  createChatCompletion,
  extractContent,
  getProviderStatus,
  listModels,
  loadUsage,
  runOpenClawTask,
  streamChatCompletion,
} from '../../../packages/provider/src/index.js'
import { callMcpTool, connectMcpServers, createMockMcpServer, getMcpStatus, readMcpConfig } from '../../../packages/mcp/src/index.js'
import { getLspStatus } from '../../../packages/lsp/src/index.js'
import { getGitCheckpoint, getGitDiffSummary, getGitStatus } from '../../../packages/git/src/index.js'
import {
  getMemoryStatus,
  appendTaskTrace as appendStoredTaskTrace,
  readMemoryTier as readStoredMemoryTier,
  readCheckpoint as readStoredCheckpoint,
  readProjectContext as readStoredProjectContext,
  readSessions as readStoredSessions,
  readStats as readStoredStats,
  recordSession as recordStoredSession,
  recordStats as recordStoredStats,
  resolveMemoryFiles,
  writeCheckpoint as writeStoredCheckpoint,
  writeSessions as writeStoredSessions,
} from '../../../packages/memory/src/index.js'
import {
  canUseColor,
  centerFitLine,
  centerLine,
  clearInteractiveScreen,
  color,
  fitVisual,
  formatBox,
  formatCommandBlock,
  formatElapsed,
  frame,
  line,
  padEndVisual,
  rule,
  statusChip,
  statusText,
  stripAnsi,
  terminalColumns,
  terminalWidth,
  visibleLength,
  wordmarkForWidth,
} from '../../../packages/tui/src/index.js'
import { COMMAND_GROUPS, COMMAND_MODULES, SLASH_COMMAND_GROUPS } from './commands/index.js'

export { DEFAULT_BASE_URL, VERSION, parseArgv }
export { formatElapsed, wordmarkForWidth }
export { COMMAND_MODULES, SLASH_COMMAND_GROUPS }

const AILLIVE_PATHS = resolveAillivePaths(process.env.AILLIVE_HOME)
const CONFIG_DIR = AILLIVE_PATHS.configDir
const CONFIG_FILE = AILLIVE_PATHS.configFile
const AUTH_FILE = AILLIVE_PATHS.authFile
const SESSIONS_DIR = AILLIVE_PATHS.sessionsDir
const SESSIONS_FILE = AILLIVE_PATHS.sessionsFile
const STATS_FILE = AILLIVE_PATHS.statsFile
const PROJECTS_DIR = AILLIVE_PATHS.projectsDir
const MEMORY_FILES = resolveMemoryFiles(CONFIG_DIR)
const CHECKPOINTS_FILE = MEMORY_FILES.checkpointsFile
const TRACES_FILE = MEMORY_FILES.tracesFile

const TOP_LEVEL_COMMANDS = COMMAND_MODULES.map((item) => item.name)

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

function printAuthFlowCard(rt = {}, loginUrl = '', callbackUrl = '') {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  console.log('')
  console.log(`${color.yellow('Login required', useColor)} ${color.gray('-', useColor)} browser auth is needed for this request.`)
  console.log(`${color.gray('Open', useColor)}   ${loginUrl}`)
  if (callbackUrl) console.log(`${color.gray('Callback', useColor)} ${callbackUrl}`)
  console.log(`${color.gray('Save', useColor)}   browser callback writes ${color.cyan('auth.json', useColor)} ${color.gray('to', useColor)} ${AUTH_FILE}`)
}

function printInteractiveHelp(rt = {}) {
  if (rt.json) return
  const useColor = canUseColor(rt.color)
  const width = Math.min(terminalWidth(), 104)
  console.log('')
  console.log(color.bold('Command Palette', useColor))
  console.log(color.gray('Type a slash command in the prompt. The request login flow only starts when an API action needs it.', useColor))
  console.log(color.gray(rule(width, '-'), useColor))
  for (const group of SLASH_COMMAND_GROUPS) {
    const { title, commands } = group
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
  sections.push('  --offline           Prefer local fake-provider runtime paths')
  sections.push('  --trace             Include trace events where supported')
  sections.push('  --verify            Run configured verification hooks where supported')
  sections.push('  --json              Print JSON output')
  sections.push('  --no-color          Disable ANSI colors')
  sections.push('  -h, --help          Show help')
  sections.push('  -v, --version       Show version')
  sections.push('')
  sections.push(color.bold('Examples', useColor))
  sections.push('  aillive setup')
  sections.push('  aillive install managed')
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

async function ensureAilliveHome() {
  await ensureDir(CONFIG_DIR)
  await ensureDir(PROJECTS_DIR)
  await ensureDir(SESSIONS_DIR)
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
  return readStoredProjectContext({
    enabled: rt.project,
    path: projectContextPath(rt.cwd),
    legacyPath: legacyProjectContextPath(rt.cwd),
    maxChars: MAX_PROJECT_CONTEXT_CHARS,
  })
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

function webOriginFromBaseUrl(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl))
  return url.origin
}

function cliAuthLoginUrl(rt, callback = null) {
  const url = new URL(webOriginFromBaseUrl(rt.baseUrl))
  url.searchParams.set('cli_auth', '1')
  url.searchParams.set('client', 'aillive-cli')
  url.searchParams.set('version', VERSION)
  if (callback?.url) {
    url.searchParams.set('callback_url', callback.url)
    url.searchParams.set('callbackUrl', callback.url)
    url.searchParams.set('redirect_uri', callback.url)
    url.searchParams.set('callback', callback.url)
  }
  if (callback?.state) url.searchParams.set('state', callback.state)
  return url.toString()
}

async function importAuthJson(file, fallback = {}) {
  const raw = await fs.readFile(file, 'utf8')
  const payload = safeParseJson(raw)
  if (!payload) throw new Error(`Invalid auth.json at ${file}.`)
  return saveAuth(normalizeAuthPayload(payload, fallback))
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  if (platform === 'darwin') return { command: 'open', args: [url] }
  return { command: 'xdg-open', args: [url] }
}

function openBrowser(url) {
  const { command, args } = browserOpenCommand(url)
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}

function openPath(target) {
  const command = process.platform === 'win32' ? 'explorer.exe' : (process.platform === 'darwin' ? 'open' : 'xdg-open')
  const child = spawn(command, [target], { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}

export function managedInstallPaths(home = CONFIG_DIR) {
  const root = path.resolve(home)
  const managedRoot = path.join(root, 'cli')
  const binDir = path.join(root, 'bin')
  return {
    home: root,
    managedRoot,
    packageDir: path.join(managedRoot, 'node_modules', '@aillive', 'cli'),
    nodeBinDir: path.join(managedRoot, 'node_modules', '.bin'),
    binDir,
  }
}

function managedInstallEntry(platform = process.platform) {
  return platform === 'win32'
    ? '..\\cli\\node_modules\\@aillive\\cli\\src\\index.js'
    : '../cli/node_modules/@aillive/cli/src/index.js'
}

function windowsCmdShim() {
  return [
    '@ECHO OFF',
    'SETLOCAL',
    `node "%~dp0${managedInstallEntry('win32')}" %*`,
    '',
  ].join('\r\n')
}

function windowsPowerShellShim() {
  return [
    '$script = Join-Path $PSScriptRoot "..\\cli\\node_modules\\@aillive\\cli\\src\\index.js"',
    '& node $script @args',
    'exit $LASTEXITCODE',
    '',
  ].join('\r\n')
}

function unixShim() {
  return [
    '#!/bin/sh',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    `exec node "$SCRIPT_DIR/${managedInstallEntry('linux')}" "$@"`,
    '',
  ].join('\n')
}

export async function writeManagedInstallShims(paths = managedInstallPaths(), platform = process.platform) {
  await ensureDir(paths.binDir)
  const names = ['aillive', 'aillive-code']
  const written = []
  if (platform === 'win32') {
    for (const name of names) {
      const cmdFile = path.join(paths.binDir, `${name}.cmd`)
      const ps1File = path.join(paths.binDir, `${name}.ps1`)
      await fs.writeFile(cmdFile, windowsCmdShim(), 'utf8')
      await fs.writeFile(ps1File, windowsPowerShellShim(), 'utf8')
      written.push(cmdFile, ps1File)
    }
    return written
  }
  for (const name of names) {
    const file = path.join(paths.binDir, name)
    await fs.writeFile(file, unixShim(), { encoding: 'utf8', mode: 0o755 })
    await fs.chmod(file, 0o755)
    written.push(file)
  }
  return written
}

function isManagedInstall(parsed) {
  return parsed.subcommand === 'managed' || parsed.args.includes('--managed')
}

function managedInstallSpec(parsed, rt) {
  const args = parsed.args.filter((item) => item !== 'managed' && item !== '--managed')
  const raw = String(args[0] || process.env.AILLIVE_CLI_INSTALL_SPEC || `@aillive/cli@${VERSION}`).trim()
  if (!raw) return `@aillive/cli@${VERSION}`
  const looksLocal = raw === '.' || raw === '..' || raw.startsWith('./') || raw.startsWith('../') || path.isAbsolute(raw)
  return looksLocal ? path.resolve(rt.cwd, raw) : raw
}

function npmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function npmInvocation() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await exists(candidate)) return { command: process.execPath, args: [candidate] }
  }
  return { command: npmCommand(), args: [] }
}

async function runProcess(command, args, rt) {
  const json = Boolean(rt.json)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rt.cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    const stdout = []
    const stderr = []
    if (json) {
      child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
      child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    }
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      reject(new Error(detail || `${command} exited with code ${code}`))
    })
  })
}

async function installManagedPackage(paths, spec, rt) {
  await ensureDir(paths.managedRoot)
  const registry = String(process.env.AILLIVE_NPM_REGISTRY || 'https://registry.npmjs.org').trim()
  const npm = await npmInvocation()
  const args = [
    'install',
    '--prefix',
    paths.managedRoot,
    '--omit=dev',
    '--no-audit',
    '--fund=false',
    '--registry',
    registry,
    spec,
  ]
  return runProcess(npm.command, [...npm.args, ...args], rt)
}

function decodeCallbackPayload(value = '') {
  const text = String(value || '').trim()
  if (!text) return null
  const direct = safeParseJson(text)
  if (direct) return direct
  try {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
    const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`
    return safeParseJson(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function callbackPayloadFrom(url, body = {}) {
  const payload = decodeCallbackPayload(url.searchParams.get('auth') || url.searchParams.get('payload') || '')
    || decodeCallbackPayload(body.auth || body.payload || '')
    || {}
  return {
    ...payload,
    ...body,
    apiKey: body.apiKey
      || body.key
      || body.token
      || body.secret
      || body.access_token
      || url.searchParams.get('apiKey')
      || url.searchParams.get('key')
      || url.searchParams.get('token')
      || url.searchParams.get('secret')
      || url.searchParams.get('access_token')
      || payload.apiKey
      || payload.key
      || payload.token
      || payload.secret
      || '',
    baseUrl: body.baseUrl || url.searchParams.get('baseUrl') || payload.baseUrl || '',
    profile: body.profile || payload.profile || null,
  }
}

async function readRequestJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error('Callback payload is too large.')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return safeParseJson(text) || Object.fromEntries(new URLSearchParams(text))
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function authCallbackCloseHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title></title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
  </style>
</head>
<body>
  <script>
    (() => {
      window.open('', '_self')
      window.close()
      setTimeout(() => {
        document.documentElement.style.background = 'transparent'
        document.body.replaceChildren()
        document.title = ''
      }, 50)
      setTimeout(() => {
        location.replace('about:blank')
      }, 180)
    })()
  </script>
</body>
</html>`
}

function authCallbackHtml({ ok = true, title = '', message = '', detail = '' } = {}) {
  const safeTitle = escapeHtml(title || (ok ? 'Aillive CLI authenticated' : 'Aillive CLI auth failed'))
  const safeMessage = escapeHtml(message || (ok ? 'Saving your local credentials' : 'The login callback could not be completed'))
  const safeDetail = escapeHtml(detail)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #101418;
      --panel: #161c22;
      --text: #f5f7fa;
      --muted: #a8b3bf;
      --accent: #37d67a;
      --line: #26313b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top left, rgba(55, 214, 122, 0.18), transparent 34rem),
        var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(28rem, calc(100vw - 2rem));
      padding: 2rem;
      border: 1px solid var(--line);
      border-radius: 1rem;
      background: color-mix(in srgb, var(--panel) 92%, transparent);
      box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.28);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
      color: var(--muted);
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .mark {
      width: 0.85rem;
      height: 0.85rem;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 1.4rem rgba(55, 214, 122, 0.75);
    }
    h1 {
      margin: 0 0 0.75rem;
      font-size: clamp(1.4rem, 4vw, 2rem);
      line-height: 1.1;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.6;
    }
    .auth-dots {
      display: inline-flex;
      gap: 0.28rem;
      margin-left: 0.18rem;
      vertical-align: 0.05em;
    }
    .auth-dots i {
      width: 0.36rem;
      height: 0.36rem;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 1s infinite ease-in-out;
    }
    .auth-dots i:nth-child(2) { animation-delay: 0.14s; }
    .auth-dots i:nth-child(3) { animation-delay: 0.28s; }
    .detail {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--line);
      font-size: 0.86rem;
      word-break: break-word;
    }
    .fallback {
      margin-top: 1rem;
      font-size: 0.82rem;
    }
    body.done .auth-dots i { animation-duration: 0.55s; }
    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.28; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-0.22rem); }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="mark"></span><span>Aillive Code</span></div>
    <h1>${safeTitle}</h1>
    <p><span data-state>${safeMessage}</span><span class="auth-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>
    ${safeDetail ? `<p class="detail">${safeDetail}</p>` : ''}
  </main>
</body>
</html>`
}

export async function startCliAuthCallbackServer(rt = {}, options = {}) {
  const state = options.state || crypto.randomBytes(16).toString('hex')
  const timeoutMs = Number(options.timeoutMs || 180000)
  let settled = false
  let closed = false
  let resolveWait
  let rejectWait
  const wait = new Promise((resolve, reject) => {
    resolveWait = resolve
    rejectWait = reject
  })
  let server
  const closeServer = () => {
    if (closed || !server) return
    closed = true
    server.close(() => {})
  }
  server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
      if (!['/', '/callback', '/auth/callback', '/cli/auth'].includes(requestUrl.pathname)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const body = req.method === 'POST' ? await readRequestJson(req) : {}
      const requestState = requestUrl.searchParams.get('state') || body.state || ''
      if (requestState !== state) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Invalid Aillive CLI auth state.')
        return
      }
      const payload = callbackPayloadFrom(requestUrl, body)
      const auth = await saveAuth({
        ...payload,
        baseUrl: payload.baseUrl || rt.baseUrl || DEFAULT_BASE_URL,
        source: 'browser callback',
      })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(authCallbackCloseHtml())
      if (!settled) {
        settled = true
        resolveWait({ auth, path: AUTH_FILE, source: 'browser callback' })
      }
      closeServer()
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(authCallbackHtml({
        ok: false,
        title: 'Aillive CLI auth failed',
        message: 'The callback could not save credentials',
        detail: error.message,
      }))
      if (!settled) {
        settled = true
        rejectWait(error)
      }
      closeServer()
    }
  })
  server.on('error', (error) => {
    if (!settled) {
      settled = true
      rejectWait(error)
    }
  })
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true
      resolveWait(null)
      closeServer()
    }
  }, timeoutMs)
  return {
    state,
    url: `http://127.0.0.1:${address.port}/callback`,
    wait: wait.finally(() => clearTimeout(timer)),
    close: () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolveWait(null)
      }
      closeServer()
    },
  }
}

async function beginWebAuthFlow(rt, { wait = true } = {}) {
  const useColor = canUseColor(rt.color)
  let callback = null
  if (wait) {
    try {
      callback = await startCliAuthCallbackServer(rt)
    } catch (error) {
      throw new Error(`AUTH_CALLBACK_UNAVAILABLE: could not start local browser callback. ${error.message}`)
    }
  }
  const loginUrl = cliAuthLoginUrl(rt, callback)
  printAuthFlowCard(rt, loginUrl, callback?.url || '')
  try {
    openBrowser(loginUrl)
  } catch (error) {
    if (!rt.json) console.log(color.yellow(`Open this URL manually: ${loginUrl}`, useColor))
  }
  if (!wait) return null
  if (!rt.json) console.log(color.yellow(`Waiting for browser callback to write ${AUTH_FILE}... keep this terminal open.`, useColor))
  const imported = await (callback?.wait || Promise.resolve(null)).finally(() => callback?.close())
  if (!imported) {
    throw new Error(`AUTH_TIMEOUT: login callback did not arrive, so ${AUTH_FILE} was not written.`)
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
  const data = await withSpinner('Loading models...', rt, () => listModels(rt))
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
    const data = await withSpinner('Thinking...', rt, () => createChatCompletion({ ...rt, body }))
    content = extractContent(data)
    rt.json ? printJson(data) : printPanel('Aillive', content || '(empty response)', rt)
  }
  await recordSession(taskMode ? 'run' : 'chat', prompt, content)
  await recordStats(taskMode ? 'run' : 'chat', Date.now() - started, true)
}

async function streamChat(rt, body, options = {}) {
  let firstOutput = false
  let wroteOutput = false
  const markOutput = () => {
    if (firstOutput) return
    firstOutput = true
    if (typeof options.onFirstOutput === 'function') options.onFirstOutput()
  }
  const content = await streamChatCompletion({
    ...rt,
    body,
    onFirstOutput: markOutput,
    onReplace: (value) => {
      if (wroteOutput) process.stdout.write('\n')
      process.stdout.write(value)
      wroteOutput = Boolean(value)
    },
    onDelta: (delta) => {
      process.stdout.write(delta)
      wroteOutput = true
    },
  })
  if (!firstOutput && typeof options.onFirstOutput === 'function') options.onFirstOutput()
  if (content) process.stdout.write('\n')
  return content
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
  return readStoredSessions(SESSIONS_FILE)
}

async function recordSession(type, prompt, content) {
  await recordStoredSession(SESSIONS_FILE, type, prompt, content, 50)
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
    await writeStoredSessions(SESSIONS_FILE, [])
    console.log('Local sessions cleared.')
    return
  }
  throw new Error(`Unknown session command: ${action}`)
}

async function readStats() {
  return readStoredStats(STATS_FILE)
}

async function recordStats(command, latencyMs, ok) {
  await recordStoredStats(STATS_FILE, command, latencyMs, ok)
}

async function writeAgentCheckpoint(checkpoint) {
  return writeStoredCheckpoint(CHECKPOINTS_FILE, checkpoint, 100)
}

async function readAgentCheckpoint(id = 'latest') {
  return readStoredCheckpoint(CHECKPOINTS_FILE, id)
}

async function appendAgentTrace(event) {
  return appendStoredTaskTrace(TRACES_FILE, event, 500)
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
  const [mcp, lsp, git, memory] = await Promise.all([
    getMcpStatus({ home: CONFIG_DIR }),
    getLspStatus({ cwd: rt.cwd }),
    getGitStatus({ cwd: rt.cwd }),
    getMemoryStatus({
      home: CONFIG_DIR,
      sessionsFile: SESSIONS_FILE,
      statsFile: STATS_FILE,
      projectContextPath: contextFile,
    }),
  ])
  const provider = getProviderStatus({ baseUrl: rt.baseUrl, apiKey: rt.apiKey, model: rt.model })
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
    subsystems: {
      provider,
      mcp,
      lsp,
      git,
      memory,
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
    { item: 'provider', state: provider.status, detail: statusDetail(provider) },
    { item: 'mcp', state: mcp.status, detail: statusDetail(mcp) },
    { item: 'lsp', state: lsp.status, detail: statusDetail(lsp) },
    { item: 'git', state: git.status, detail: statusDetail(git) },
    { item: 'memory', state: memory.status, detail: statusDetail(memory) },
  ], ['item', 'state', 'detail'])
  console.log('')
  console.log(payload.authenticated
    ? color.green('Ready. Try `aillive chat --stream "Hello"`.', canUseColor(rt.color))
    : color.yellow('Next: run `aillive auth login`, `aillive setup`, or set AILLIVE_API_KEY.', canUseColor(rt.color)))
}

async function collectArchitectureStatuses(rt) {
  const provider = await checkProviderStatus({ baseUrl: rt.baseUrl, apiKey: rt.apiKey, model: rt.model })
  const mcp = await getMcpStatus({ home: CONFIG_DIR })
  const lsp = await getLspStatus({ cwd: rt.cwd })
  const git = await getGitStatus({ cwd: rt.cwd })
  const memory = await getMemoryStatus({
    home: CONFIG_DIR,
    sessionsFile: SESSIONS_FILE,
    statsFile: STATS_FILE,
    projectContextPath: projectContextPath(rt.cwd),
  })
  const runtimeStatus = getRuntimeStatus({ subsystems: [provider, mcp, lsp, git, memory] })
  return { runtime: runtimeStatus, provider, mcp, lsp, git, memory }
}

function statusDetail(payload) {
  if (payload.component === 'provider') {
    const modelCheck = payload.models
      ? (payload.models.ok ? ` · ${payload.models.count} models` : ` · models failed: ${payload.models.error}`)
      : ''
    const hint = payload.remediationHint ? ` · ${payload.remediationHint}` : ''
    return `${payload.baseUrl || '(missing base URL)'} · ${payload.authenticated ? 'auth ok' : 'auth missing'} · ${payload.model}${modelCheck}${hint}`
  }
  if (payload.component === 'mcp') {
    return `${payload.configPath || '(no config path)'} · ${payload.servers?.length || 0} servers`
  }
  if (payload.component === 'lsp') {
    const languages = payload.detectedLanguages?.length ? payload.detectedLanguages.join(', ') : 'none detected'
    return `${payload.cwd} · ${languages}`
  }
  if (payload.component === 'git') {
    if (!payload.available) return payload.error || payload.cwd
    return `${payload.branch} · ${payload.changedFiles} changed files`
  }
  if (payload.component === 'memory') {
    return `${payload.home} · ${payload.counts?.sessions || 0} sessions · ${payload.counts?.checkpoints || 0} checkpoints · ${payload.storageBytes || 0} bytes`
  }
  if (payload.component === 'runtime') {
    return `${payload.subsystems?.length || 0} subsystems · ${payload.readyForAgentRun ? 'ready' : 'partial'}`
  }
  return ''
}

function printArchitectureStatus(title, payload, rt) {
  if (rt.json) return printJson(payload)
  printBrand(rt, title)
  if (payload.component === 'runtime') {
    printTable([
      {
        item: 'runtime',
        state: payload.status,
        detail: statusDetail(payload),
      },
      ...(payload.subsystems || []).map((item) => ({
        item: item.component,
        state: item.status,
        detail: statusDetail(item),
      })),
    ], ['item', 'state', 'detail'])
    printPanel('State Machine', payload.stateMachine.join(' -> '), rt)
    return
  }
  printTable([{
    item: payload.component,
    state: payload.status,
    detail: statusDetail(payload),
  }], ['item', 'state', 'detail'])
}

function architectureUsage(command) {
  const usage = {
    runtime: 'Usage: aillive runtime status',
    provider: 'Usage: aillive provider status',
    mcp: 'Usage: aillive mcp status|list|call <tool> [json]',
    lsp: 'Usage: aillive lsp status',
    git: 'Usage: aillive git status|diff --summary|checkpoint',
    memory: 'Usage: aillive memory status|search <query>',
  }
  return usage[command] || 'Usage: aillive runtime|provider|mcp|lsp|git|memory status'
}

function builtinMcpServers() {
  return [
    createMockMcpServer({
      id: 'builtin',
      tools: {
        echo: {
          description: 'Echo args for offline MCP smoke tests',
          risk: 'read',
          execute: (args) => JSON.stringify(args),
        },
      },
    }),
  ]
}

async function loadMcpServers() {
  const loaded = await readMcpConfig({ home: CONFIG_DIR })
  return [
    ...connectMcpServers(loaded.config),
    ...builtinMcpServers(),
  ]
}

async function cmdArchitecture(parsed, command) {
  const action = parsed.subcommand || 'status'
  const allowed = action === 'status'
    || (command === 'mcp' && ['list', 'call'].includes(action))
    || (command === 'git' && ['diff', 'checkpoint'].includes(action))
    || (command === 'memory' && action === 'search')
  if (!allowed) {
    throw new Error(architectureUsage(command))
  }
  const rt = await runtime(parsed.global)
  if (command === 'mcp' && action === 'call') {
    const name = parsed.rest[0] || ''
    if (!name) throw new Error(architectureUsage(command))
    const argsText = parsed.rest.slice(1).join(' ').trim()
    const args = argsText ? (safeParseJson(argsText) || { input: argsText }) : {}
    const result = await callMcpTool({
      servers: await loadMcpServers(),
      name,
      args,
      confirmed: parsed.global.force,
    })
    return rt.json ? printJson(result) : printPanel('MCP Tool Result', result.output, rt)
  }
  if (command === 'git' && action === 'diff') {
    const payload = await getGitDiffSummary({ cwd: rt.cwd })
    return printArchitectureStatus('Aillive Git Diff', payload, rt)
  }
  if (command === 'git' && action === 'checkpoint') {
    const payload = await getGitCheckpoint({ cwd: rt.cwd })
    return printArchitectureStatus('Aillive Git Checkpoint', payload, rt)
  }
  if (command === 'memory' && action === 'search') {
    const query = parsed.rest.join(' ').trim()
    if (!query) throw new Error(architectureUsage(command))
    const { searchMemory } = await import('../../../packages/memory/src/index.js')
    const payload = {
      component: 'memory',
      status: 'available',
      query,
      results: await searchMemory(query, {
        home: CONFIG_DIR,
        sessionsFile: SESSIONS_FILE,
        checkpointsFile: CHECKPOINTS_FILE,
        tracesFile: TRACES_FILE,
        projectContextPath: projectContextPath(rt.cwd),
        legacyProjectContextPath: legacyProjectContextPath(rt.cwd),
      }),
    }
    return rt.json ? printJson(payload) : printTable(payload.results, ['tier', 'id', 'text'])
  }
  const statuses = await collectArchitectureStatuses(rt)
  const payload = statuses[command]
  if (command === 'mcp' && action === 'list') {
    const listPayload = { ...payload, tools: payload.tools || [], servers: payload.servers || [] }
    return printArchitectureStatus('Aillive MCP', listPayload, rt)
  }
  const title = {
    runtime: 'Aillive Runtime',
    provider: 'Aillive Provider',
    mcp: 'Aillive MCP',
    lsp: 'Aillive LSP',
    git: 'Aillive Git',
    memory: 'Aillive Memory',
  }[command]
  return printArchitectureStatus(title, payload, rt)
}

async function cmdAgent(parsed) {
  const action = parsed.subcommand || 'plan'
  const rt = await runtime(parsed.global)
  if (action === 'plan') {
    const objective = parsed.rest.join(' ').trim()
    if (!objective) throw new Error('Usage: aillive agent plan "task"')
    const plan = planAgentTask(objective, { mode: 'plan', network: 'disabled', tools: 'disabled' })
    if (rt.json) return printJson(plan)
    printBrand(rt, 'Aillive Agent Plan')
    printPanel('Objective', plan.objective, rt)
    return printTable(plan.steps.map((step) => ({
      id: step.id,
      status: step.status,
      title: step.title,
    })), ['id', 'status', 'title'])
  }
  if (action === 'verify') {
    const started = Date.now()
    const verification = await runCommandVerifications(defaultVerificationCommands, { cwd: rt.cwd })
    await recordStats('agent:verify', Date.now() - started, verification.every((item) => item.ok))
    const payload = {
      ok: verification.every((item) => item.ok),
      verification,
    }
    if (!payload.ok) process.exitCode = 1
    if (rt.json) return printJson(payload)
    printBrand(rt, 'Aillive Agent Verify')
    printTable(verification.map((item) => ({
      check: item.name,
      ok: item.ok ? 'yes' : 'no',
      durationMs: item.durationMs,
      detail: item.detail,
    })), ['check', 'ok', 'durationMs', 'detail'])
    return
  }
  if (action === 'run') {
    const objective = parsed.rest.join(' ').trim()
    if (!objective) throw new Error('Usage: aillive agent run "task"')
    const started = Date.now()
    const [project, git, lsp] = await Promise.all([
      readProjectContext(rt),
      getGitStatus({ cwd: rt.cwd }),
      getLspStatus({ cwd: rt.cwd }),
    ])
    const result = await runAgentTask({
      objective,
      context: { project, git, lsp },
      verificationHooks: parsed.global.verify
        ? defaultVerificationCommands.map((command) => async () => (await runCommandVerifications([command], { cwd: rt.cwd }))[0])
        : [
          () => ({ name: 'offline-runtime', ok: true, detail: 'fake provider executed without network' }),
        ],
      memory: {
        readTier: (tier) => readStoredMemoryTier(tier, {
          home: CONFIG_DIR,
          sessionsFile: SESSIONS_FILE,
          statsFile: STATS_FILE,
          checkpointsFile: CHECKPOINTS_FILE,
          tracesFile: TRACES_FILE,
          projectContextPath: projectContextPath(rt.cwd),
          legacyProjectContextPath: legacyProjectContextPath(rt.cwd),
        }),
        writeCheckpoint: writeAgentCheckpoint,
        appendTrace: appendAgentTrace,
      },
      memoryTiers: ['project', 'task'],
    })
    await recordStats('agent', Date.now() - started, true)
    if (rt.json) return printJson(result)
    printBrand(rt, 'Aillive Agent')
    printPanel('Objective', objective, rt)
    printPanel('Result', result.output, rt)
    printTable(result.verification.map((item) => ({
      check: item.name,
      ok: item.ok ? 'yes' : 'no',
      detail: item.detail,
    })), ['check', 'ok', 'detail'])
    printPanel('Checkpoint', `${result.checkpoint.id}\n${CHECKPOINTS_FILE}`, rt)
    if (parsed.global.trace) {
      printTable(result.run.events.map((event) => ({
        type: event.type,
        state: event.state || '',
        at: event.at || '',
      })), ['type', 'state', 'at'])
    }
    return
  }
  if (action === 'resume') {
    const id = parsed.rest[0] || 'latest'
    const checkpoint = await readAgentCheckpoint(id)
    const result = await resumeAgentRun({ checkpoint, id })
    if (rt.json) return printJson(result)
    printBrand(rt, 'Aillive Agent Resume')
    printPanel('Checkpoint', result.checkpoint.id, rt)
    printPanel('Objective', result.objective || '(empty)', rt)
    printPanel('Summary', result.summary || '(empty)', rt)
    printPanel('Next', result.next, rt)
    return
  }
  throw new Error('Usage: aillive agent plan|run|resume "task"')
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
  const data = await withSpinner('Running OpenClaw task...', rt, () => runOpenClawTask({ ...rt, task }))
  await recordStats('openclaw', 0, true)
  return rt.json ? printJson(data) : printPanel('Result', extractContent(data.response) || data.task?.result || JSON.stringify(data, null, 2), rt)
}

async function cmdUsage(parsed) {
  const rt = await ensureAuthForRequest(await runtime(parsed.global), 'usage')
  const data = await withSpinner('Loading usage...', rt, () => loadUsage({ ...rt, from: parsed.global.from, to: parsed.global.to }))
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
      const data = await listModels(rt)
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
  if (isManagedInstall(parsed)) {
    const paths = managedInstallPaths(CONFIG_DIR)
    const spec = managedInstallSpec(parsed, rt)
    if (!rt.json) {
      printBrand(rt, 'Aillive Managed Install')
      printPanel('Install Target', [
        `Package: ${spec}`,
        `Home: ${paths.home}`,
        `CLI: ${paths.packageDir}`,
        `Bin: ${paths.binDir}`,
      ].join('\n'), rt)
    }
    await installManagedPackage(paths, spec, rt)
    const shims = await writeManagedInstallShims(paths)
    const entry = path.join(paths.packageDir, 'src', 'index.js')
    if (!(await exists(entry))) throw new Error(`Managed install did not create ${entry}.`)
    if (rt.json) {
      console.log(JSON.stringify({
        ok: true,
        package: spec,
        home: paths.home,
        cli: paths.packageDir,
        bin: paths.binDir,
        shims,
      }, null, 2))
      return
    }
    printPanel('Managed Install Complete', [
      `CLI package: ${paths.packageDir}`,
      `Command shims: ${paths.binDir}`,
      '',
      'Add this directory to PATH if it is not already available:',
      `  ${paths.binDir}`,
      '',
      'Then run:',
      '  aillive --version',
    ].join('\n'), rt)
    return
  }
  printBrand(rt, 'Aillive Install')
  printPanel('Install From npm', formatCommandBlock([
    'npm install -g @aillive/cli',
    'aillive install managed',
    'aillive --version',
    'aillive setup',
    'aillive doctor',
    'aillive',
  ]), rt)
  printPanel('Managed Install Under ~/.aillive', formatCommandBlock([
    'npx @aillive/cli install managed',
    'aillive install managed',
  ]), rt)
  printPanel('Install From This Folder', formatCommandBlock([
    'cd "Aillive CLI"',
    'npm install -g .',
    'aillive install managed .',
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
    case 'agent': return cmdAgent(parsed)
    case 'init': return cmdInit(parsed)
    case 'context': return cmdContext(parsed)
    case 'session': return cmdSession(parsed)
    case 'stats': return cmdStats(parsed)
    case 'runtime': return cmdArchitecture(parsed, 'runtime')
    case 'provider': return cmdArchitecture(parsed, 'provider')
    case 'mcp': return cmdArchitecture(parsed, 'mcp')
    case 'lsp': return cmdArchitecture(parsed, 'lsp')
    case 'git': return cmdArchitecture(parsed, 'git')
    case 'memory': return cmdArchitecture(parsed, 'memory')
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
    if (parsed.global?.json) console.log(JSON.stringify(errorToJson(error), null, 2))
    else {
      const enabled = parsed.global?.color !== false
      console.error(color.red(`Error: ${error.message}`, enabled))
    }
    process.exitCode = Number(error.status || 1) === 1 ? 1 : 1
    try {
      await recordStats(parsed.command || 'unknown', 0, false)
    } catch {}
  }
}

if (process.env.AILLIVE_CLI_IMPORT_ONLY !== '1') {
  main()
}
