export const packageName = '@aillive/lsp'
export const packageRole = 'Language server discovery, diagnostics, symbols, references, and workspace intelligence.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'skeleton',
  }
}

const languageHints = [
  ['javascript', ['package.json', 'jsconfig.json']],
  ['typescript', ['tsconfig.json']],
  ['python', ['pyproject.toml', 'requirements.txt']],
  ['rust', ['Cargo.toml']],
  ['go', ['go.mod']],
]

export async function getLspStatus(options = {}) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const cwd = options.cwd || process.cwd()
  const detected = []
  for (const [language, files] of languageHints) {
    for (const file of files) {
      try {
        await fs.access(path.join(cwd, file))
        detected.push(language)
        break
      } catch {}
    }
  }
  return {
    component: 'lsp',
    package: packageName,
    status: detected.length ? 'available-for-project' : 'disabled',
    configured: false,
    cwd,
    detectedLanguages: detected,
    servers: [],
    diagnostics: {
      available: false,
      count: 0,
    },
  }
}
