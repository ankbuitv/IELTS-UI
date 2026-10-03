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
  /**
   * False for a server that does not authenticate (a local Ollama daemon, an
   * in-cluster gateway). Defaults to true: cloud endpoints always need a key.
   */
  requiresKey?: boolean;
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
  /** False when the endpoint needs no authentication (local Ollama daemon). */
  requiresKey: boolean;
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

/**
 * Ollama names the same hosted model differently depending on who is asking:
 *
 *   - the Ollama app / CLI, and a local daemon that forwards to the cloud, use a
 *     `-cloud` (or `:cloud`) suffix: `gpt-oss:120b-cloud`;
 *   - a DIRECT request to ollama.com (`https://ollama.com/v1`, the endpoint this
 *     platform calls) uses the bare name listed by `/api/tags`: `gpt-oss:120b`.
 *
 * An admin can legitimately type either, so `ollamaModelCandidates()` returns
 * the spellings to try, best first, and the worker falls back to the provider's
 * own model list when none of them exists.
 */
export const OLLAMA_CLOUD_HOST = 'ollama.com';

export function isOllamaCloudBaseUrl(baseUrl: string): boolean {
  const host = (normaliseBaseUrl(baseUrl) || '').replace(/^[a-z]+:\/\//i, '');
  return /^(?:[^/]+\.)?ollama\.com(?::\d+)?(?:\/|$)/i.test(host);
}

/** `gpt-oss:120b` → `gpt-oss:120b-cloud`; already-suffixed tags are untouched. */
export function cloudModelTag(model: string): string {
  const trimmed = (model ?? '').trim();
  if (!trimmed || /-cloud$|:cloud$/.test(trimmed)) return trimmed;
  return `${trimmed}-cloud`;
}

/** `gpt-oss:120b-cloud` → `gpt-oss:120b`; `deepseek-v3.2:cloud` → `deepseek-v3.2`. */
export function bareModelTag(model: string): string {
  return (model ?? '').trim().replace(/-cloud$/i, '').replace(/:cloud$/i, '');
}

/**
 * Model spellings to try, in order. Direct ollama.com wants the bare name first;
 * any other endpoint is called with the name exactly as the admin typed it.
 */
export function ollamaModelCandidates(model: string, baseUrl: string): string[] {
  const typed = (model ?? '').trim();
  if (!typed) return [];
  if (!isOllamaCloudBaseUrl(baseUrl)) return [typed];
  return [...new Set([bareModelTag(typed), typed, cloudModelTag(typed)].filter(Boolean))];
}

/** Models offered as one-tap presets; the field itself stays free text. */
export const MODEL_PRESETS: Array<{ id: string; label: string; kind?: AiProviderKind }> = [
  { id: 'gpt-oss:120b', label: 'gpt-oss:120b — strongest open reasoning model (ollama.com)', kind: 'OLLAMA' },
  { id: 'gemma4:31b', label: 'gemma4:31b — Google, balanced quality (ollama.com)', kind: 'OLLAMA' },
  { id: 'gpt-oss:20b', label: 'gpt-oss:20b — fast, cheap (ollama.com)', kind: 'OLLAMA' },
  { id: 'gemma3:27b', label: 'gemma3:27b — previous generation (ollama.com)', kind: 'OLLAMA' },
  { id: 'deepseek-v3.2', label: 'deepseek-v3.2 (ollama.com)', kind: 'OLLAMA' },
  { id: 'gpt-oss:120b-cloud', label: 'gpt-oss:120b-cloud — name used by a local Ollama app / CLI', kind: 'OLLAMA' },
  { id: 'gpt-4.1', label: 'gpt-4.1', kind: 'OPENAI' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', kind: 'OPENAI' },
  { id: 'gpt-5-mini', label: 'gpt-5-mini', kind: 'OPENAI' },
];

export const SPEECH_TO_TEXT_MODELS: Array<{ id: string; label: string }> = [
  { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (OpenAI)' },
  { id: 'whisper-1', label: 'whisper-1 (OpenAI)' },
  { id: 'whisper-large-v3', label: 'whisper-large-v3 (self-hosted)' },
];

/** True for a host that is only reachable from the machine running the Worker. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  const host = (normaliseBaseUrl(baseUrl) || '').replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? '';
  const hostname = host.split(':')[0] ?? '';
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'host.docker.internal';
}

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

/** The provider's model list (`GET …/models`), derived the same way as the chat URL. */
export function buildModelsEndpoint(provider: Pick<AiProviderConfig, 'kind' | 'baseUrl'>): string {
  const chat = buildProviderEndpoint(provider);
  return chat.replace(/\/chat\/completions$/, '/models');
}

/** Transcription endpoint for providers that expose OpenAI's audio API. */
export function buildTranscriptionEndpoint(
  provider: Pick<AiProviderConfig, 'kind' | 'baseUrl'>,
): string {
  const base = normaliseBaseUrl(provider.baseUrl) || DEFAULT_PROVIDER_BASE_URLS[provider.kind];
  const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  return `${root}/audio/transcriptions`;
}

/** The OpenAI-compatible text-to-speech route, for generated practice audio. */
export function buildSpeechEndpoint(
  provider: Pick<AiProviderConfig, 'kind' | 'baseUrl'>,
): string {
  const base = normaliseBaseUrl(provider.baseUrl) || DEFAULT_PROVIDER_BASE_URLS[provider.kind];
  const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
  return `${root}/audio/speech`;
}

export interface AiProviderDraft {
  id?: string;
  label?: string;
  kind?: AiProviderKind;
  baseUrl?: string;
  model?: string;
  /** Omit to keep the stored key, send an empty string to clear it. */
  apiKey?: string;
  requiresKey?: boolean;
  enabled?: boolean;
  isDefault?: boolean;
  sttModel?: string | null;
}

/**
 * Redacts a stored provider for transport to the browser. Never let a raw key
 * reach a response body: `hasKey`/`keyHint` are all the UI needs.
 */
export function providerNeedsKey(provider: Pick<AiProviderConfig, 'requiresKey'>): boolean {
  return provider.requiresKey !== false;
}

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
    requiresKey: provider.requiresKey !== false,
    hasKey: key.trim().length > 0,
    keyHint: key.trim().length >= 4 ? key.trim().slice(-4) : null,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}
