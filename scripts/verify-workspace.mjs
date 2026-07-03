import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const packages = [
  ['apps/cli', '@aillive/cli'],
  ['packages/core', '@aillive/core'],
  ['packages/tui', '@aillive/tui'],
  ['packages/provider', '@aillive/provider'],
  ['packages/mcp', '@aillive/mcp'],
  ['packages/lsp', '@aillive/lsp'],
  ['packages/git', '@aillive/git'],
  ['packages/memory', '@aillive/memory'],
  ['packages/agent-runtime', '@aillive/agent-runtime'],
]

const internalNames = new Set(packages.map(([, name]) => name))
const allowedInternalDeps = new Map([
  ['@aillive/cli', new Set([...internalNames].filter((name) => name !== '@aillive/cli'))],
  ['@aillive/core', new Set()],
  ['@aillive/tui', new Set(['@aillive/core'])],
  ['@aillive/provider', new Set(['@aillive/core'])],
  ['@aillive/mcp', new Set(['@aillive/core'])],
  ['@aillive/lsp', new Set(['@aillive/core'])],
  ['@aillive/git', new Set(['@aillive/core'])],
  ['@aillive/memory', new Set(['@aillive/core'])],
  ['@aillive/agent-runtime', new Set([
    '@aillive/core',
    '@aillive/provider',
    '@aillive/mcp',
    '@aillive/lsp',
    '@aillive/git',
    '@aillive/memory',
  ])],
])

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function dependencyEntries(pkg) {
  return Object.entries({
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  })
}

const rootPkg = await readJson(path.join(root, 'package.json'))
assert(Array.isArray(rootPkg.workspaces), 'root package.json must define workspaces')
assert(rootPkg.workspaces.includes('apps/*'), 'root workspaces must include apps/*')
assert(rootPkg.workspaces.includes('packages/*'), 'root workspaces must include packages/*')
assert(rootPkg.bin?.aillive === './apps/cli/src/index.js', 'root bin.aillive must point at apps/cli/src/index.js')
assert(rootPkg.bin?.['aillive-code'] === './apps/cli/src/index.js', 'root bin.aillive-code must point at apps/cli/src/index.js')
assert(rootPkg.files?.includes('apps/cli/src'), 'root files must include apps/cli/src')
assert(rootPkg.files?.includes('packages/*/src/**'), 'root files must include package source files')
assert(rootPkg.files?.includes('packages/*/package.json'), 'root files must include package manifests')

for (const [relativeDir, expectedName] of packages) {
  const packageDir = path.join(root, relativeDir)
  const packageJsonPath = path.join(packageDir, 'package.json')
  const srcIndexPath = path.join(packageDir, 'src', 'index.js')
  assert(await exists(packageJsonPath), `${relativeDir}/package.json is missing`)
  assert(await exists(srcIndexPath), `${relativeDir}/src/index.js is missing`)

  const pkg = await readJson(packageJsonPath)
  assert(pkg.name === expectedName, `${relativeDir} must be named ${expectedName}`)
  assert(pkg.type === 'module', `${expectedName} must be ESM`)
  assert(pkg.exports?.['.'] === './src/index.js', `${expectedName} must export ./src/index.js`)

  const allowed = allowedInternalDeps.get(expectedName) || new Set()
  for (const [depName] of dependencyEntries(pkg)) {
    if (!internalNames.has(depName)) continue
    assert(allowed.has(depName), `${expectedName} must not depend on ${depName}`)
  }
}

console.log(`workspace ok: ${packages.length} packages verified`)
