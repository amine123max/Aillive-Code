import test from 'node:test'
import assert from 'node:assert/strict'
import {
  color,
  fitVisual,
  formatCommandPalette,
  formatElapsed,
  interactivePrompt,
  renderStreamChunk,
  stripAnsi,
  visibleLength,
  workingIndicatorFrame,
  wordmarkForWidth,
} from '../src/index.js'

test('tui strips ANSI and measures visible length', () => {
  const painted = color.green('OK', true)
  assert.equal(stripAnsi(painted), 'OK')
  assert.equal(visibleLength(painted), 2)
})

test('tui wordmark adapts to terminal width', () => {
  assert.deepEqual(wordmarkForWidth(40), ['AILLIVE'])
  assert.notDeepEqual(wordmarkForWidth(58), ['AILLIVE'])
  assert.equal(Math.max(...wordmarkForWidth(120).map(visibleLength)) <= 120, true)
})

test('tui formats elapsed time and fits long text', () => {
  assert.equal(formatElapsed(1250), '1.2s')
  assert.equal(formatElapsed(61000), '1m01s')
  assert.equal(fitVisual('abcdefghijklmnopqrstuvwxyz', 8), 'abcde...')
})

test('tui renders command palette, prompt, spinner frame, and stream chunks', () => {
  const palette = formatCommandPalette([{ title: 'Session', commands: [['/help', 'Show help']] }], { color: false }, { width: 48 })
  assert.match(palette, /Session/)
  assert.match(palette, /\/help/)
  assert.equal(interactivePrompt({ color: false }), '> ')
  assert.match(stripAnsi(workingIndicatorFrame('Working', Date.now(), 0, { color: false })), /Working/)
  assert.deepEqual(renderStreamChunk('hello', 'hello world'), { prefix: '', text: ' world', replace: false })
})
