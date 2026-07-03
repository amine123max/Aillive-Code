import {
  authHeaders,
  normalizeBaseUrl,
  safeParseJson,
} from '../../core/src/index.js'

export const packageName = '@aillive/provider'
export const packageRole = 'Provider registry, model metadata, chat, streaming, usage, and OpenClaw API clients.'
export const DEFAULT_TIMEOUT_MS = 60000
export const DEFAULT_RETRIES = 0

export class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'ProviderError'
    this.status = options.status
    this.payload = options.payload
    this.trace = options.trace
    this.cause = options.cause
  }
}

export function describePackage() {
  return {
    name: packageName,
    role: packageRole,
    status: 'active',
  }
}

export function apiRoot(baseUrl) {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/i, '')
}

export function createTrace(input = {}) {
  const url = input.url ? new URL(String(input.url)) : null
  return {
    provider: input.provider || 'aillive',
    method: input.method || 'GET',
    path: url ? `${url.pathname}${url.search}` : '',
    status: input.status,
    attempt: input.attempt,
    timeoutMs: input.timeoutMs,
  }
}

function redactHeaders(headers = {}) {
  const result = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = /authorization|api[-_]key|token|secret/i.test(key) ? '[redacted]' : value
  }
  return result
}

function requestHeaders(apiKey, headers = {}) {
  return {
    ...authHeaders(apiKey),
    ...headers,
  }
}

function mergeSignals(signals) {
  const filtered = signals.filter(Boolean)
  if (!filtered.length) return undefined
  if (filtered.length === 1) return filtered[0]
  const controller = new AbortController()
  const abort = (event) => {
    if (!controller.signal.aborted) controller.abort(event?.target?.reason)
  }
  for (const signal of filtered) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

function timeoutSignal(timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return { signal: undefined, clear: () => {} }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`TIMEOUT_${timeoutMs}MS`)), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

function shouldRetry(error) {
  if (error?.name === 'AbortError') return false
  if (!error?.status) return true
  return error.status === 429 || error.status >= 500
}

function errorMessageFromBody(status, bodyText) {
  const json = bodyText ? safeParseJson(bodyText) : null
  return {
    json,
    message: json?.error?.message || json?.message || bodyText || `HTTP_${status}`,
  }
}

export async function requestJson(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : DEFAULT_RETRIES
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const method = options.method || 'GET'
  const headers = options.headers || {}
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = timeoutSignal(timeoutMs)
    const trace = createTrace({
      provider: options.provider || 'aillive',
      url,
      method,
      attempt,
      timeoutMs,
    })
    try {
      if (typeof options.onTrace === 'function') {
        options.onTrace({ ...trace, event: 'request', headers: redactHeaders(headers) })
      }
      const response = await fetch(url, {
        ...options,
        method,
        headers,
        signal: mergeSignals([options.signal, timeout.signal]),
      })
      const text = await response.text()
      const data = text ? safeParseJson(text) : {}
      const responseTrace = { ...trace, status: response.status }
      if (typeof options.onTrace === 'function') options.onTrace({ ...responseTrace, event: 'response' })
      if (!response.ok) {
        const { json, message } = errorMessageFromBody(response.status, text)
        throw new ProviderError(message, {
          status: response.status,
          payload: json || text,
          trace: responseTrace,
        })
      }
      return data
    } catch (error) {
      const providerError = error instanceof ProviderError
        ? error
        : new ProviderError(error?.message || 'PROVIDER_REQUEST_FAILED', {
          cause: error,
          trace,
        })
      lastError = providerError
      if (typeof options.onTrace === 'function') {
        options.onTrace({
          ...providerError.trace,
          event: 'error',
          status: providerError.status,
          message: providerError.message,
        })
      }
      if (attempt >= retries || !shouldRetry(providerError)) throw providerError
    } finally {
      timeout.clear()
    }
  }

  throw lastError
}

export function providerRegistry(options = {}) {
  let baseUrl = ''
  let valid = true
  if (options.baseUrl) {
    try {
      baseUrl = normalizeBaseUrl(options.baseUrl)
    } catch {
      baseUrl = String(options.baseUrl)
      valid = false
    }
  }
  return [
    {
      id: 'aillive',
      type: 'aillive',
      baseUrl,
      status: valid ? (baseUrl ? 'configured' : 'unconfigured') : 'invalid-config',
      capabilities: ['models', 'chat', 'streaming', 'usage', 'openclaw'],
    },
    {
      id: 'openai-compatible',
      type: 'openai-compatible',
      baseUrl,
      status: valid ? (baseUrl ? 'available' : 'available-via-base-url') : 'invalid-config',
      capabilities: ['models', 'chat', 'streaming'],
    },
  ]
}

export function normalizeModel(model = {}) {
  const id = String(model.id || model.name || model.model || model.value || '').trim()
  const label = String(model.label || model.displayName || model.name || id || '').trim()
  const owner = String(model.owned_by || model.owner || model.provider || model.vendor || '').trim()
  const contextWindow = Number(model.context_window || model.contextWindow || model.max_context_tokens || model.maxTokens || 0) || null
  const capabilities = model.capabilities || {}
  const supports = {
    streaming: Boolean(model.supports_streaming ?? model.streaming ?? capabilities.streaming ?? true),
    tools: Boolean(model.supports_tools ?? model.tools ?? capabilities.tools ?? false),
    search: Boolean(model.supports_search ?? model.search ?? capabilities.search ?? false),
    openclaw: Boolean(model.supports_openclaw ?? model.openclaw ?? capabilities.openclaw ?? owner === 'aillive'),
  }
  return {
    id,
    label,
    owned_by: owner,
    contextWindow,
    supports,
    raw: model,
  }
}

export function normalizeModelList(data = {}) {
  const records = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : [])
  const normalized = records.map(normalizeModel).filter((model) => model.id)
  return {
    object: data.object || 'list',
    data: normalized,
    raw: data,
  }
}

export async function listModels(options = {}) {
  const data = await requestJson(`${normalizeBaseUrl(options.baseUrl)}/models`, {
    provider: options.provider || 'aillive',
    headers: requestHeaders(options.apiKey, options.headers),
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    signal: options.signal,
    onTrace: options.onTrace,
  })
  return normalizeModelList(data)
}

export async function createChatCompletion(options = {}) {
  return requestJson(`${normalizeBaseUrl(options.baseUrl)}/chat/completions`, {
    provider: options.provider || 'aillive',
    method: 'POST',
    headers: requestHeaders(options.apiKey, options.headers),
    body: JSON.stringify(options.body || {}),
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    signal: options.signal,
    onTrace: options.onTrace,
  })
}

export function extractContent(data) {
  return data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.content
    || data?.response
    || ''
}

function parseStreamEvent(text) {
  const lines = String(text || '').split(/\r?\n/)
  const data = []
  let event = ''
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') event = value
    if (field === 'data') data.push(value)
  }
  return { event, data: data.join('\n').trim() }
}

export async function streamChatCompletion(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const timeout = timeoutSignal(timeoutMs)
  const url = `${normalizeBaseUrl(options.baseUrl)}/chat/completions`
  const trace = createTrace({
    provider: options.provider || 'aillive',
    url,
    method: 'POST',
    attempt: 0,
    timeoutMs,
  })
  let content = ''
  let firstOutput = false
  const markOutput = () => {
    if (firstOutput) return
    firstOutput = true
    if (typeof options.onFirstOutput === 'function') options.onFirstOutput()
  }

  try {
    if (typeof options.onTrace === 'function') options.onTrace({ ...trace, event: 'request' })
    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders(options.apiKey, options.headers),
      body: JSON.stringify(options.body || {}),
      signal: mergeSignals([options.signal, timeout.signal]),
    })
    if (typeof options.onTrace === 'function') options.onTrace({ ...trace, event: 'response', status: response.status })
    if (!response.ok) {
      const text = await response.text()
      const { json, message } = errorMessageFromBody(response.status, text)
      throw new ProviderError(message, {
        status: response.status,
        payload: json || text,
        trace: { ...trace, status: response.status },
      })
    }

    const decoder = new TextDecoder()
    let buffer = ''
    const consume = (eventText) => {
      const event = parseStreamEvent(eventText)
      const text = event.data
      if (!text || text === '[DONE]') return
      const json = safeParseJson(text)
      if (!json) return
      if (json.type === 'error') throw new ProviderError(json.message || 'STREAM_ERROR', { trace })
      if (json.type === 'replace_content' && json.content) {
        markOutput()
        content = String(json.content)
        if (typeof options.onReplace === 'function') options.onReplace(content, json)
        return
      }
      const delta = (typeof json.delta === 'string' ? json.delta : json.delta?.content)
        || json.content
        || json.choices?.[0]?.delta?.content
        || json.choices?.[0]?.message?.content
        || ''
      if (delta) {
        markOutput()
        content += delta
        if (typeof options.onDelta === 'function') options.onDelta(String(delta), json)
      }
    }

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() || ''
      for (const part of parts) consume(part)
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
    if (!firstOutput && typeof options.onFirstOutput === 'function') options.onFirstOutput()
    return content
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError(error?.message || 'PROVIDER_STREAM_FAILED', {
      cause: error,
      trace,
    })
  } finally {
    timeout.clear()
  }
}

export async function loadUsage(options = {}) {
  const params = new URLSearchParams()
  if (options.from) params.set('from', options.from)
  if (options.to) params.set('to', options.to)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return requestJson(`${normalizeBaseUrl(options.baseUrl)}/usage${suffix}`, {
    provider: options.provider || 'aillive',
    headers: requestHeaders(options.apiKey, options.headers),
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    signal: options.signal,
    onTrace: options.onTrace,
  })
}

export async function runOpenClawTask(options = {}) {
  return requestJson(`${apiRoot(options.baseUrl)}/openclaw/v1/tasks`, {
    provider: options.provider || 'aillive',
    method: 'POST',
    headers: requestHeaders(options.apiKey, options.headers),
    body: JSON.stringify({
      task: options.task,
      model: options.model || undefined,
    }),
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    signal: options.signal,
    onTrace: options.onTrace,
  })
}

export function getProviderStatus(options = {}) {
  const rawBaseUrl = String(options.baseUrl || '').trim()
  const model = String(options.model || '').trim()
  const authenticated = Boolean(String(options.apiKey || '').trim())
  let baseUrl = ''
  let baseUrlError = ''
  if (rawBaseUrl) {
    try {
      baseUrl = normalizeBaseUrl(rawBaseUrl)
    } catch (error) {
      baseUrl = rawBaseUrl
      baseUrlError = error.message
    }
  }
  const configured = Boolean(rawBaseUrl && !baseUrlError)
  return {
    component: 'provider',
    package: packageName,
    status: baseUrlError ? 'invalid-config' : (configured ? 'configured' : 'unconfigured'),
    configured,
    authenticated,
    baseUrl,
    model: model || '(server default)',
    checks: {
      baseUrl: configured,
      auth: authenticated,
      models: null,
      defaultModel: Boolean(model),
    },
    remediationHint: baseUrlError
      ? 'Use an http:// or https:// provider base URL.'
      : (authenticated ? '' : 'Run `aillive auth login`, `aillive setup`, or set AILLIVE_API_KEY.'),
    error: baseUrlError,
    providers: providerRegistry({ baseUrl }),
  }
}

export async function checkProviderStatus(options = {}) {
  const status = getProviderStatus(options)
  if (!status.configured || !status.authenticated) return status
  try {
    const models = await listModels({
      ...options,
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5000,
      retries: Number.isFinite(options.retries) ? options.retries : 0,
    })
    const ids = new Set((models.data || []).map((model) => model.id))
    status.status = 'ready'
    status.checks.models = true
    status.checks.defaultModel = status.model === '(server default)' || ids.has(status.model)
    status.models = {
      ok: true,
      count: models.data?.length || 0,
    }
    if (!status.checks.defaultModel) {
      status.status = 'degraded'
      status.remediationHint = `Default model "${status.model}" was not returned by /models.`
    }
    return status
  } catch (error) {
    return {
      ...status,
      status: 'degraded',
      checks: {
        ...status.checks,
        models: false,
      },
      models: {
        ok: false,
        error: error.message,
      },
      remediationHint: 'Check provider base URL, auth.json/API key, and network access.',
    }
  }
}
