import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function readJson(file) {
  return JSON.parse(await fs.readFile(path.join(root, file), 'utf8'))
}

test('root package declares workspace CLI architecture', async () => {
  const pkg = await readJson('package.json')
  assert.deepEqual(pkg.workspaces, ['apps/*', 'packages/*'])
  assert.equal(pkg.bin.aillive, './apps/cli/src/index.js')
  assert.equal(pkg.bin['aillive-code'], './apps/cli/src/index.js')
  assert.equal(pkg.files.includes('apps/cli/src'), true)
  assert.equal(pkg.files.includes('packages/*/src/**'), true)
  assert.equal(pkg.files.includes('packages/*/package.json'), true)
})

test('root package exposes release gate scripts', async () => {
  const pkg = await readJson('package.json')
  assert.equal(pkg.scripts['check:release'], 'node ./scripts/check-release.mjs')
  assert.equal(pkg.scripts['pack:smoke'], 'node ./scripts/pack-smoke.mjs')
  assert.equal(pkg.scripts['smoke:npx'], 'npm run pack:smoke')
  assert.match(pkg.scripts['publish:check'], /npm run check:release/)
  assert.match(pkg.scripts['publish:check'], /npm run pack:smoke/)
})

test('internal package skeletons expose metadata', async () => {
  const packageDirs = [
    ['packages/core', '@aillive/core', 'active'],
    ['packages/tui', '@aillive/tui', 'active'],
    ['packages/provider', '@aillive/provider', 'active'],
    ['packages/mcp', '@aillive/mcp', 'active'],
    ['packages/lsp', '@aillive/lsp', 'active'],
    ['packages/git', '@aillive/git', 'active'],
    ['packages/memory', '@aillive/memory', 'active'],
    ['packages/agent-runtime', '@aillive/agent-runtime', 'active'],
  ]

  for (const [dir, name, status] of packageDirs) {
    const pkg = await readJson(`${dir}/package.json`)
    const mod = await import(`../${dir}/src/index.js`)
    assert.equal(pkg.name, name)
    assert.equal(pkg.exports['.'], './src/index.js')
    assert.equal(mod.describePackage().name, name)
    assert.equal(mod.describePackage().status, status)
  }
})
