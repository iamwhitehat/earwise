// API key intake — detect the provider from the key, then ask that provider
// what the key can actually reach.
//
// The model list is fetched live rather than hardcoded, because a hardcoded
// list goes stale and, worse, offers models the key has no access to. If the
// call fails the key is reported as invalid — which is the useful answer.
//
// The key is never logged and never echoed back in full.

export type ProviderId = 'anthropic' | 'openai' | 'groq' | 'openrouter' | 'google' | 'voyage'

export type Provider = {
  id: ProviderId
  label: string
  /** Whether the scan pipeline can actually use it today. */
  usable: boolean
  note?: string
}

const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: { id: 'anthropic', label: 'Anthropic', usable: true },
  openai: {
    id: 'openai', label: 'OpenAI', usable: false,
    note: 'detected, but classification is built on the Anthropic SDK — not wired up yet',
  },
  groq: {
    id: 'groq', label: 'Groq', usable: false,
    note: 'detected, but classification is built on the Anthropic SDK — not wired up yet',
  },
  openrouter: {
    id: 'openrouter', label: 'OpenRouter', usable: false,
    note: 'detected, but classification is built on the Anthropic SDK — not wired up yet',
  },
  google: {
    id: 'google', label: 'Google AI', usable: false,
    note: 'detected, but classification is built on the Anthropic SDK — not wired up yet',
  },
  voyage: {
    id: 'voyage', label: 'Voyage', usable: false,
    note: 'embeddings only — used for topic similarity, not classification',
  },
}

/** Order matters: sk-ant- and sk-or- must be tested before the bare sk- rule. */
export function detectProvider(key: string): Provider | null {
  const k = key.trim()
  if (/^sk-ant-/.test(k)) return PROVIDERS.anthropic
  if (/^sk-or-v1-/.test(k)) return PROVIDERS.openrouter
  if (/^gsk_/.test(k)) return PROVIDERS.groq
  if (/^pa-/.test(k)) return PROVIDERS.voyage
  if (/^AIza/.test(k)) return PROVIDERS.google
  if (/^sk-/.test(k)) return PROVIDERS.openai
  return null
}

export type ModelInfo = { id: string; label: string }

type Probe = { url: string; headers: Record<string, string> }

function probeFor(p: ProviderId, key: string): Probe | null {
  switch (p) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=100',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      }
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } }
    case 'groq':
      return { url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: `Bearer ${key}` } }
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/models', headers: { Authorization: `Bearer ${key}` } }
    case 'google':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        headers: {},
      }
    default:
      return null // Voyage has no public model-list endpoint
  }
}

function parseModels(p: ProviderId, json: unknown): ModelInfo[] {
  const out: ModelInfo[] = []
  const j = json as Record<string, unknown>
  const rows =
    (Array.isArray(j?.data) && j.data) || (Array.isArray(j?.models) && j.models) || []
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = String(r?.id ?? r?.name ?? '')
    if (!id) continue
    const label = String(r?.display_name ?? r?.displayName ?? id)
    out.push({ id: id.replace(/^models\//, ''), label })
  }
  // Chat-capable models only; embedding and audio models are noise here.
  const filtered = out.filter((m) => !/embed|whisper|tts|moderation|dall-e|image/i.test(m.id))
  return (filtered.length ? filtered : out).slice(0, 60)
}

export type KeyCheck = {
  ok: boolean
  provider: Provider | null
  models: ModelInfo[]
  /** Safe to show: first and last few characters only. */
  masked: string
  error?: string
}

export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 12) return '•'.repeat(k.length)
  return `${k.slice(0, 8)}${'•'.repeat(Math.min(18, k.length - 12))}${k.slice(-4)}`
}

export async function checkKey(key: string): Promise<KeyCheck> {
  const k = key.trim()
  const provider = detectProvider(k)
  const masked = maskKey(k)
  if (!provider) {
    return { ok: false, provider: null, models: [], masked, error: 'unrecognised key format' }
  }

  const probe = probeFor(provider.id, k)
  if (!probe) {
    // No list endpoint — the shape is all we can honestly confirm.
    return { ok: true, provider, models: [], masked, error: 'key shape recognised; no model list available' }
  }

  try {
    const res = await fetch(probe.url, {
      headers: probe.headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return {
        ok: false,
        provider,
        models: [],
        masked,
        error: res.status === 401 || res.status === 403 ? 'key rejected by provider' : `provider returned ${res.status}`,
      }
    }
    const models = parseModels(provider.id, await res.json())
    return { ok: true, provider, models, masked }
  } catch (err) {
    return { ok: false, provider, models: [], masked, error: (err as Error).message }
  }
}

/** Upsert a KEY=value line in .env.local without disturbing the other lines. */
export function upsertEnv(text: string, name: string, value: string): string {
  const line = `${name}=${value}`
  const re = new RegExp(`^${name}=.*$`, 'm')
  if (re.test(text)) return text.replace(re, line)
  return text.replace(/\s*$/, '') + `\n${line}\n`
}
