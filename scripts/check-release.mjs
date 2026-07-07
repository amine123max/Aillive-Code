import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const expectedFiles = [
  'apps/cli/src',
  'apps/cli/package.json',
  'packages/*/src/**',
  'packages/*/package.json',
  'src',
  'docs/assets/aillive-code-terminal.png',
  'docs/assets/aillive_code.png',
  'README.md',
  'README.zh.md',
  'LICENSE',
]

const requiredScripts = [
  'check',
  'check:workspace',
  'check:syntax',
  'check:release',
  'test',
  'test:integration',
  'smoke:npx',
  'pack:smoke',
  'pack:dry',
  'publish:check',
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readText(file) {
  return fs.readFile(path.join(root, file), 'utf8')
}

async function readJson(file) {
  return JSON.parse(await readText(file))
}

async function assertExists(file) {
  try {
    await fs.access(path.join(root, file))
  } catch {
    throw new Error(`${file} is missing`)
  }
}

function arraysEqual(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index])
}

const pkg = await readJson('package.json')

const requiredDocs = [
  'docs/architecture.md',
  'docs/commands.md',
  'docs/provider.md',
  'docs/mcp.md',
  'docs/lsp.md',
  'docs/git.md',
  'docs/memory.md',
  'docs/agent-runtime.md',
  'docs/testing.md',
  'docs/release.md',
]

assert(pkg.name === '@aillive/cli', 'package name must stay @aillive/cli')
assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version), 'package version must be semver')
assert(pkg.type === 'module', 'root package must be ESM')
assert(pkg.license === 'MIT', 'license must be MIT')
assert(pkg.engines?.node === '>=18', 'Node engine must be >=18')
assert(pkg.publishConfig?.access === 'public', 'publishConfig.access must be public')
assert(pkg.bin?.aillive === 'src/index.js', 'bin.aillive must point at src/index.js')
assert(pkg.bin?.['aillive-code'] === 'src/index.js', 'bin.aillive-code must point at src/index.js')
assert(arraysEqual(pkg.files || [], expectedFiles), 'package files allowlist must match release policy')

for (const script of requiredScripts) {
  assert(pkg.scripts?.[script], `package script "${script}" is missing`)
}

assert(pkg.scripts['publish:check'].includes('npm run check:release'), 'publish:check must run check:release')
assert(pkg.scripts['publish:check'].includes('npm run pack:smoke'), 'publish:check must run pack:smoke')
assert(pkg.scripts['publish:check'].includes('npm run pack:dry'), 'publish:check must run pack:dry')

await Promise.all([
  assertExists('apps/cli/src/index.js'),
  assertExists('src/index.js'),
  assertExists('README.md'),
  assertExists('README.zh.md'),
  assertExists('CHANGELOG.md'),
  assertExists('LICENSE'),
  assertExists('.github/workflows/release.yml'),
  ...requiredDocs.map((file) => assertExists(file)),
])

const cliEntry = await readText('src/index.js')
assert(cliEntry.startsWith('#!/usr/bin/env node'), 'CLI bin shim must keep node shebang')

const changelog = await readText('CHANGELOG.md')
const versionHeading = new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')} - \\d{4}-\\d{2}-\\d{2}$`, 'm')
assert(versionHeading.test(changelog), `CHANGELOG.md must contain a release heading for ${pkg.version}`)

const readme = await readText('README.md')
const readmeZh = await readText('README.zh.md')
const releaseWorkflow = await readText('.github/workflows/release.yml')
for (const [file, text] of [['README.md', readme], ['README.zh.md', readmeZh]]) {
  assert(text.includes('npm run publish:check'), `${file} must document publish:check`)
  assert(text.includes('npm run check:release'), `${file} must document check:release`)
  assert(text.includes('npm run pack:smoke'), `${file} must document pack:smoke`)
  assert(text.includes('npm publish'), `${file} must document npm publish`)
  assert(text.includes('npm install -g @aillive/cli'), `${file} must document global install`)
}

assert(releaseWorkflow.includes('workflow_dispatch'), 'release workflow must be manually triggered')
assert(releaseWorkflow.includes('publish_to_npm'), 'release workflow must require an explicit npm publish input')
assert(releaseWorkflow.includes('npm run publish:check'), 'release workflow must run publish:check')
assert(releaseWorkflow.includes('npm publish --provenance --access public'), 'release workflow must reserve npm provenance publishing')

for (const file of requiredDocs) {
  const text = await readText(file)
  for (const heading of ['## Purpose', '## Commands', '## Config', '## Failure Modes', '## Test Expectations']) {
    assert(text.includes(heading), `${file} must include ${heading}`)
  }
}

const forbiddenDeps = ['@mimo-ai/cli']
for (const dep of forbiddenDeps) {
  assert(!pkg.dependencies?.[dep], `${dep} must not be a runtime dependency`)
}

console.log(`release ok: ${pkg.name}@${pkg.version}`)
