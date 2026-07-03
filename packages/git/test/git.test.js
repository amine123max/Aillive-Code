import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildGitAgentContext, getGitCheckpoint, getGitDiffSummary, getGitStatus, parsePorcelainStatus } from '../src/index.js'

const execFileAsync = promisify(execFile)

async function hasGit() {
  try {
    await execFileAsync('git', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, windowsHide: true })
}

test('git parses porcelain status safely', () => {
  const changes = parsePorcelainStatus(' M src/index.js\n?? notes.md\nA  staged.js')
  assert.equal(changes.length, 3)
  assert.equal(changes[0].unstaged, true)
  assert.equal(changes[1].untracked, true)
  assert.equal(changes[2].staged, true)
})

test('git status reports non-repository directories without throwing', async (t) => {
  if (!(await hasGit())) return t.skip('git is not available')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-git-nonrepo-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))

  const status = await getGitStatus({ cwd: dir })

  assert.equal(status.component, 'git')
  assert.equal(status.available, false)
  assert.equal(status.status, 'not-a-repository')
})

test('git status covers clean, dirty, staged, and untracked files', async (t) => {
  if (!(await hasGit())) return t.skip('git is not available')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aillive-git-repo-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))

  await git(dir, ['init'])
  await git(dir, ['config', 'user.email', 'cli@example.com'])
  await git(dir, ['config', 'user.name', 'Aillive CLI'])
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'hello\n', 'utf8')
  await git(dir, ['add', 'tracked.txt'])
  await git(dir, ['commit', '-m', 'initial'])

  const clean = await getGitStatus({ cwd: dir })
  assert.equal(clean.available, true)
  assert.equal(clean.status, 'clean')
  assert.equal(clean.dirty, false)
  assert.equal(clean.changedFiles, 0)
  assert.equal(clean.recentCommits.length, 1)

  await fs.writeFile(path.join(dir, 'tracked.txt'), 'hello\nchanged\n', 'utf8')
  await fs.writeFile(path.join(dir, 'new.txt'), 'new\n', 'utf8')
  const dirty = await getGitStatus({ cwd: dir })
  assert.equal(dirty.status, 'dirty')
  assert.equal(dirty.unstagedFiles.includes('tracked.txt'), true)
  assert.equal(dirty.untrackedFiles.includes('new.txt'), true)
  assert.equal(dirty.diffSummary.length > 0, true)

  await git(dir, ['add', 'tracked.txt'])
  const staged = await getGitStatus({ cwd: dir })
  assert.equal(staged.stagedFiles.includes('tracked.txt'), true)
  assert.equal(staged.stagedDiffSummary.length > 0, true)
  assert.equal(staged.checkpoint.dirty, true)

  const diff = await getGitDiffSummary({ cwd: dir })
  const checkpoint = await getGitCheckpoint({ cwd: dir })
  const agentContext = buildGitAgentContext(staged)
  assert.equal(diff.available, true)
  assert.equal(diff.stagedDiffSummary.length > 0, true)
  assert.equal(checkpoint.checkpoint.stagedFiles.includes('tracked.txt'), true)
  assert.equal(agentContext.protectedUserChanges, true)
})
