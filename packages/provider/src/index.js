export const packageName = '@aillive/provider'
export const packageRole = 'Provider registry, model metadata, chat, streaming, usage, and OpenClaw API clients.'

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'skeleton',
  }
}

export function getProviderStatus(options = {}) {
  const baseUrl = String(options.baseUrl || '').trim()
  const model = String(options.model || '').trim()
  const authenticated = Boolean(String(options.apiKey || '').trim())
  return {
    component: 'provider',
    package: packageName,
    status: baseUrl ? 'configured' : 'unconfigured',
    configured: Boolean(baseUrl),
    authenticated,
    baseUrl,
    model: model || '(server default)',
    providers: [
      {
        id: 'aillive',
        type: 'aillive',
        status: baseUrl ? 'configured' : 'unconfigured',
        capabilities: ['models', 'chat', 'streaming', 'usage', 'openclaw'],
      },
      {
        id: 'openai-compatible',
        type: 'openai-compatible',
        status: 'available-via-base-url',
        capabilities: ['models', 'chat', 'streaming'],
      },
    ],
  }
}
