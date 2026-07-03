export const packageName = '@aillive/git'
export const packageRole = 'Git status, branch, diff summaries, recent commits, and checkpoint metadata.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

async function runGit(cwd, args, options = {}) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const result = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  const output = String(result.stdout || '')
  return options.trim === false ? output.trimEnd() : output.trim()
}

export function parsePorcelainStatus(porcelain = '') {
  return String(porcelain || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2)
      const file = line.slice(3).trim()
      return {
        raw: line,
        index: status[0],
        worktree: status[1],
        file,
        staged: status[0] !== ' ' && status[0] !== '?',
        unstaged: status[1] !== ' ',
        untracked: status === '??',
      }
    })
}

function splitLines(value = '') {
  return String(value || '').split('\n').map((line) => line.trimEnd()).filter(Boolean)
}

export async function getGitDiffSummary(options = {}) {
  const status = await getGitStatus(options)
  if (!status.available) return { ...status, diffSummary: [], stagedDiffSummary: [] }
  return {
    component: 'git',
    package: packageName,
    status: status.status,
    available: true,
    cwd: status.cwd,
    root: status.root,
    branch: status.branch,
    head: status.head,
    dirty: status.dirty,
    changedFiles: status.changedFiles,
    diffSummary: status.diffSummary,
    stagedDiffSummary: status.stagedDiffSummary,
    changes: status.changes,
  }
}

export async function getGitCheckpoint(options = {}) {
  const status = await getGitStatus(options)
  if (!status.available) return { ...status, checkpoint: null }
  return {
    component: 'git',
    package: packageName,
    status: status.status,
    available: true,
    cwd: status.cwd,
    root: status.root,
    branch: status.branch,
    head: status.head,
    dirty: status.dirty,
    changedFiles: status.changedFiles,
    checkpoint: {
      ...status.checkpoint,
      createdAt: new Date().toISOString(),
      diffSummary: status.diffSummary,
      stagedDiffSummary: status.stagedDiffSummary,
      untrackedFiles: status.untrackedFiles,
      stagedFiles: status.stagedFiles,
      unstagedFiles: status.unstagedFiles,
      recentCommits: status.recentCommits,
    },
  }
}

export function buildGitAgentContext(status = {}) {
  return {
    status: status.status || 'unavailable',
    branch: status.branch || '',
    head: status.head || '',
    dirty: Boolean(status.dirty),
    changedFiles: status.changedFiles || 0,
    diffSummary: status.diffSummary || [],
    stagedDiffSummary: status.stagedDiffSummary || [],
    protectedUserChanges: Boolean(status.dirty),
  }
}

export async function getGitStatus(options = {}) {
  const cwd = options.cwd || process.cwd()
  try {
    const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') {
      return {
        component: 'git',
        package: packageName,
        status: 'not-a-repository',
        available: false,
        cwd,
      }
    }
    const [root, branch, head, porcelain, diffSummary, stagedDiffSummary, commits] = await Promise.all([
      runGit(cwd, ['rev-parse', '--show-toplevel']),
      runGit(cwd, ['branch', '--show-current']).catch(() => ''),
      runGit(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => ''),
      runGit(cwd, ['status', '--short'], { trim: false }).catch(() => ''),
      runGit(cwd, ['diff', '--stat']).catch(() => ''),
      runGit(cwd, ['diff', '--cached', '--stat']).catch(() => ''),
      runGit(cwd, ['log', '-5', '--pretty=format:%h %s']).catch(() => ''),
    ])
    const changes = parsePorcelainStatus(porcelain)
    const untrackedFiles = changes.filter((item) => item.untracked).map((item) => item.file)
    const stagedFiles = changes.filter((item) => item.staged).map((item) => item.file)
    const unstagedFiles = changes.filter((item) => item.unstaged && !item.untracked).map((item) => item.file)
    return {
      component: 'git',
      package: packageName,
      status: changes.length ? 'dirty' : 'clean',
      available: true,
      cwd,
      root,
      branch: branch || '(detached)',
      head,
      dirty: changes.length > 0,
      changedFiles: changes.length,
      changes,
      untrackedFiles,
      stagedFiles,
      unstagedFiles,
      diffSummary: splitLines(diffSummary),
      stagedDiffSummary: splitLines(stagedDiffSummary),
      recentCommits: splitLines(commits),
      checkpoint: {
        root,
        branch: branch || '(detached)',
        head,
        dirty: changes.length > 0,
        changedFiles: changes.map((item) => item.file),
      },
    }
  } catch (error) {
    const message = `${error.message || ''}\n${error.stderr || ''}`
    if (/not a git repository/i.test(message)) {
      return {
        component: 'git',
        package: packageName,
        status: 'not-a-repository',
        available: false,
        cwd,
      }
    }
    return {
      component: 'git',
      package: packageName,
      status: 'unavailable',
      available: false,
      cwd,
      error: error.message,
    }
  }
}
