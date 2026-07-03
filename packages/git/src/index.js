export const packageName = '@aillive/git'
export const packageRole = 'Git status, branch, diff summaries, recent commits, and checkpoint metadata.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'skeleton',
  }
}

async function runGit(cwd, args) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const result = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return String(result.stdout || '').trim()
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
    const [root, branch, porcelain, commits] = await Promise.all([
      runGit(cwd, ['rev-parse', '--show-toplevel']),
      runGit(cwd, ['branch', '--show-current']).catch(() => ''),
      runGit(cwd, ['status', '--short']).catch(() => ''),
      runGit(cwd, ['log', '-5', '--pretty=format:%h %s']).catch(() => ''),
    ])
    const changes = porcelain ? porcelain.split('\n').filter(Boolean) : []
    return {
      component: 'git',
      package: packageName,
      status: changes.length ? 'dirty' : 'clean',
      available: true,
      cwd,
      root,
      branch: branch || '(detached)',
      dirty: changes.length > 0,
      changedFiles: changes.length,
      recentCommits: commits ? commits.split('\n').filter(Boolean) : [],
    }
  } catch (error) {
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
