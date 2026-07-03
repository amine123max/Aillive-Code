import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const includeDirs = ['src', 'apps', 'packages', 'scripts', 'test']
const extensions = new Set(['.js', '.mjs'])

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function collectFiles(dir, files = []) {
  if (!(await exists(dir))) return files
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files)
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

const files = []
for (const dir of includeDirs) {
  await collectFiles(path.join(root, dir), files)
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status || 1)
  }
}

console.log(`syntax ok: ${files.length} files checked`)
