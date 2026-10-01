/**
 * AI provider configuration, shared by the Worker (which talks to the provider)
 * and the browser (which renders the admin form).
 *
 * SECURITY: this module is bundled into the client. It therefore describes the
 * *shape* of a provider — never a stored key. A key is write-only: the admin
 * form posts it, the Worker stores it, and every read endpoint returns only
 * `hasKey` plus a short hint. `buildProviderEndpoint()` below is a plain string
 * helper with no secret in it.
 *
 * Providers are OpenAI-Chat-Completions compatible:
 *   - OLLAMA              https://ollama.com (cloud) or a self-hosted daemon
 *   - OPENAI              https://api.openai.com/v1
 *   - OPENAI_COMPATIBLE   any gateway that speaks /chat/completions
 *
 * Ollama's cloud service exposes the same OpenAI-compatible surface at
 * `https://ollama.com/v1`, so one request path serves every provider and the
 * `kind` only decides defaults and which extra parameters are sent.
 */

export const AI_PROVIDER_KINDS = ['OLLAMA', 'OPENAI', 'OPENAI_COMPATIBLE'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export interface AiProviderConfig {
  id: string;
  label: string;
  kind: AiProviderKind;
  /** Base URL including the version segment, e.g. `https://ollama.com/v1`. */
  baseUrl: string;
  model: string;
  /** Write-only. Never returned by any endpoint. */
  apiKey?: string;
  enabled: boolean;
  isDefault: boolean;
  /** Optional speech-to-text model (OpenAI-compatible `/audio/transcriptions`). */
  sttModel?: string;
  createdAt: string;
  updatedAt: string;
}

/** What the browser is allowed to see about a provider. */
export interface AiProviderPublic {
  id: string;
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  sttModel: string | null;
  /** True when a key is stored. The key itself is never sent. */
  hasKey: boolean;
  /** Last two characters of the key, for an admin to recognise it. */
  keyHint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiStatus {
  available: boolean;
  /** The provider that would be used right now, when one is available. */
  providerId?: string;
  providerLabel?: string;
  model?: string;
  kind?: AiProviderKind;
  reason?: string;
  /** True when the key comes from the Worker environment, not the database. */
  fromEnvironment?: boolean;
}

export const DEFAULT_PROVIDER_BASE_URLS: Record<AiProviderKind, string> = {
  OLLAMA: 'https://ollama.com/v1',
  OPENAI: 'https://api.openai.com/v1',
  OPENAI_COMPATIBLE: 'https://example.com/v1',
};

export const PROVIDER_KIND_LABELS: Record<AiProviderKind, string> = {
  OLLAMA: 'Ollama (cloud or local)',
  OPENAI: 'OpenAI',
  OPENAI_COMPATIBLE: 'OpenAI-compatible gateway',
};

/** Models offered as one-tap presets; the field itself stays free text. */
export const MODEL_PRESETS: Array<{ id: string; label: string; kind?: AiProviderKind }> = [
  { id: 'gpt-oss:120b', label: 'gpt-oss:120b — strongest open reasoning model', kind: 'OLLAMA' },
  { id: 'gpt-oss:20b', label: 'gpt-oss:20b — fast, cheap', kind: 'OLLAMA' },
  { id: 'gemma3:27b', label: 'gemma3:27b — balanced quality', kind: 'OLLAMA' },
  { id: 'gemma3:12b', label: 'gemma3:12b — fast', kind: 'OLLAMA' },
  { id: 'qwen3:32b', label: 'qwen3:32b', kind: 'OLLAMA' },
  { id: 'deepseek-v3.1:671b', label: 'deepseek-v3.1:671b — cloud, large', kind: 'OLLAMA' },
  { id: 'kimi-k2:1t', label: 'kimi-k2:1t — cloud, large', kind: 'OLLAMA' },
  { id: 'glm-4.6', label: 'glm-4.6 — cloud', kind: 'OLLAMA' },
  { id: 'gpt-4.1', label: 'gpt-4.1', kind: 'OPENAI' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', kind: 'OPENAI' },
  { id: 'gpt-5-mini', label: 'gpt-5-mini', kind: 'OPENAI' },
];

export const SPEECH_TO_TEXT_MODELS: Array<{ id: string; label: string }> = [
  { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (OpenAI)' },
  { id: 'whisper-1', label: 'whisper-1 (OpenAI)' },
  { id: 'whisper-large-v3', label: 'whisper-large-v3 (self-hosted)' },
];

/** Trims a trailing slash so `${baseUrl}/chat/completions` is always well formed. */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed;
}

/**
 * The single place that decides which URL a chat completion is posted to.
 *
 * Accepts either a base that already ends in `/v1` (the documented value) or a
 * bare origin (`https://ollama.com`), and never appends a secret.
 */
export function buildProviderEndpoint(provider: Pick<AiProviderConfig, 'kind' | 'baseUrl'>): string {
  const base = normaliseBaseUrl(provider.baseUrl) || DEFAULT_PROVIDER_BASE_URLS[provider.kind];
  if (base.endsWith('/chat/completions')) return base;
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** Transcription endpoint for providers that expose OpenAI's audio API. */
export function buildTranscriptionEndpoint(
  provider: Pick<AiProviderConfig, 'kind' | 'baseUrl'>,
): string {
  const base = normaliseBaseUrl(provider.baseUrl) || DEFAULT_PROVIDER_BASE_URLS[provider.kind];
  const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  return `${root}/audio/transcriptions`;
}

export interface AiProviderDraft {
  id?: string;
  label?: string;
  kind?: AiProviderKind;
  baseUrl?: string;
  model?: string;
  /** Omit to keep the stored key, send an empty string to clear it. */
  apiKey?: string;
  enabled?: boolean;
  isDefault?: boolean;
  sttModel?: string | null;
}

/**
 * Redacts a stored provider for transport to the browser. Never let a raw key
 * reach a response body: `hasKey`/`keyHint` are all the UI needs.
 */
export function toPublicProvider(
  provider: AiProviderConfig & { apiKey?: string | undefined },
): AiProviderPublic {
  const key = provider.apiKey ?? '';
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    model: provider.model,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    sttModel: provider.sttModel ?? null,
    hasKey: key.trim().length > 0,
    keyHint: key.trim().length >= 4 ? key.trim().slice(-4) : null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
