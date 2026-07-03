export const packageName = '@aillive/tui'
export const packageRole = 'Terminal rendering, prompts, panels, status chips, and stream output.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export const color = {
  bold: (text, enabled) => enabled ? `\x1b[1m${text}\x1b[0m` : text,
  dim: (text, enabled) => enabled ? `\x1b[2m${text}\x1b[0m` : text,
  green: (text, enabled) => enabled ? `\x1b[32m${text}\x1b[0m` : text,
  red: (text, enabled) => enabled ? `\x1b[31m${text}\x1b[0m` : text,
  cyan: (text, enabled) => enabled ? `\x1b[36m${text}\x1b[0m` : text,
  magenta: (text, enabled) => enabled ? `\x1b[35m${text}\x1b[0m` : text,
  yellow: (text, enabled) => enabled ? `\x1b[33m${text}\x1b[0m` : text,
  gray: (text, enabled) => enabled ? `\x1b[90m${text}\x1b[0m` : text,
}

export function canUseColor(enabled = true, stream = process.stdout) {
  return Boolean(enabled && stream.isTTY && process.env.NO_COLOR === undefined)
}

export function line(width = 64) {
  return '-'.repeat(width)
}

export function rule(width = 64, char = '-') {
  return char.repeat(Math.max(0, width))
}

export function stripAnsi(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '')
}

export function visibleLength(value) {
  return stripAnsi(value).length
}

export function padEndVisual(value, width) {
  const text = String(value ?? '')
  return `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`
}

export function fitVisual(value, width) {
  const text = String(value ?? '')
  if (visibleLength(text) <= width) return text
  const plain = stripAnsi(text)
  return `${plain.slice(0, Math.max(0, width - 3))}...`
}

export function indentBlock(value, spaces = 2) {
  const prefix = ' '.repeat(spaces)
  return String(value || '').split('\n').map((item) => `${prefix}${item}`).join('\n')
}

export function terminalWidth(stream = process.stdout) {
  const columns = Number(stream.columns || process.env.COLUMNS || 96)
  return Math.max(24, Math.min(Number.isFinite(columns) ? columns : 96, 128))
}

export function terminalColumns(stream = process.stdout) {
  const columns = Number(stream.columns || process.env.COLUMNS || 96)
  return Math.max(24, Number.isFinite(columns) ? columns : 96)
}

export function formatBox(lines, enabled = true, width = Math.min(terminalWidth(), 72)) {
  const innerWidth = width - 4
  const border = `+${'-'.repeat(width - 2)}+`
  const body = lines.map((item) => `| ${padEndVisual(fitVisual(item, innerWidth), innerWidth)} |`)
  return [border, ...body, border].join('\n')
}

export function frame(title, rows, rt = {}, options = {}) {
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

export function formatCommandBlock(lines) {
  return lines.map((item) => `  $ ${item}`).join('\n')
}

export function centerLine(value, width = terminalColumns()) {
  const text = String(value || '')
  return `${' '.repeat(Math.max(0, Math.floor((width - visibleLength(text)) / 2)))}${text}`
}

export function centerFitLine(value, width = terminalColumns()) {
  return centerLine(fitVisual(value, Math.max(1, width)), width)
}

export function clearInteractiveScreen(rt = {}) {
  if (!rt.json && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H')
}

export function statusText(label, value, ok, rt = {}) {
  const useColor = canUseColor(rt.color)
  const state = ok ? color.green(String(value), useColor) : color.red(String(value), useColor)
  return `${color.gray(label, useColor)} ${state}`
}

export function statusChip(label, value, tone = 'muted', rt = {}) {
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
