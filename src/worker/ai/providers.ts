import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import {
  buildProviderEndpoint,
  buildTranscriptionEndpoint,
  cloudModelTag,
  isLocalBaseUrl,
  isOllamaCloudBaseUrl,
  normaliseBaseUrl,
  providerNeedsKey,
  toPublicProvider,
  type AiProviderConfig,
  type AiProviderKind,
  type AiProviderPublic,
  type AiStatus,
} from '../../shared/ai';

/**
 * Multiple AI providers, configured by an administrator at runtime.
 *
 * Why this exists: the platform must not be welded to one vendor. An admin adds
 * any number of OpenAI-Chat-Completions-compatible endpoints — Ollama cloud
 * (`https://ollama.com/v1`, models such as `gpt-oss:120b` or `gemma3:27b`), the
 * OpenAI API, or a self-hosted gateway — and marks one as the default. Every AI
 * feature (import structuring, Writing feedback, Speaking feedback, question
 * generation) resolves its provider here.
 *
 * Guarantees:
 *  - keys live in D1 (`platform_settings.ai_providers`) and in Worker secrets;
 *    they are never returned by any endpoint — `toPublicProvider` redacts them;
 *  - a provider that is disabled or has no key is never selected;
 *  - every request has a timeout, so one slow provider cannot hang a request;
 *  - failures are reported with the provider label and HTTP status, never with
 *    the key or the full upstream body.
 */

export const AI_PROVIDERS_SETTING_KEY = 'ai_providers';
const ENV_PROVIDER_ID = 'env-openai';

interface StoredProviders {
  providers: AiProviderConfig[];
}

/** Reads the configured providers, newest last, always returning a fresh array. */
export async function loadProviders(env: Env): Promise<AiProviderConfig[]> {
  const row = await env.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?')
    .bind(AI_PROVIDERS_SETTING_KEY)
    .first<{ value_json: string }>()
    .catch(() => null);

  const stored = parseJson<StoredProviders>(row?.value_json ?? '', { providers: [] });
  const providers = Array.isArray(stored.providers) ? stored.providers.map(normaliseProvider) : [];

  // Environment fallback: Worker secrets still work without any database
  // configuration, so a deployment keeps running across a lost `ai_providers`
  // row. `OLLAMA_API_KEYS` is a comma-separated list — each key becomes its own
  // provider so the failover in `completeChat` rotates across them.
  const ollamaKeys = parseKeyList([env.OLLAMA_API_KEYS, env.OLLAMA_API_KEY]);
  const now = nowIso();
  ollamaKeys.forEach((apiKey, index) => {
    if (providers.some((provider) => (provider.apiKey ?? '').trim() === apiKey)) return;
    providers.push({
      id: `env-ollama-${index + 1}`,
      label: ollamaKeys.length > 1 ? `Ollama Cloud (secret #${index + 1})` : 'Ollama Cloud (Worker secret)',
      kind: 'OLLAMA',
      baseUrl: normaliseBaseUrl(env.OLLAMA_BASE_URL ?? '') || 'https://ollama.com/v1',
      model: (env.OLLAMA_MODEL ?? '').trim() || 'gpt-oss:120b-cloud',
      apiKey,
      enabled: true,
      isDefault: !providers.some((provider) => provider.isDefault),
      createdAt: now,
      updatedAt: now,
    });
  });

  // Environment fallback: an OPENAI_API_KEY secret still works without any
  // database configuration, so an existing deployment keeps running.
  if (env.OPENAI_API_KEY && !providers.some((provider) => (provider.apiKey ?? '').trim())) {
    providers.push({
      id: ENV_PROVIDER_ID,
      label: 'OpenAI (Worker secret)',
      kind: 'OPENAI',
      baseUrl: 'https://api.openai.com/v1',
      model: env.OPENAI_MODEL || 'gpt-4.1',
      apiKey: env.OPENAI_API_KEY,
      enabled: true,
      isDefault: !providers.some((provider) => provider.isDefault),
      sttModel: env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
      createdAt: now,
      updatedAt: now,
    });
  }

  return providers;
}

/**
 * Splits a comma/newline-separated secret into individual keys, trimmed and
 * de-duplicated in order. Blank entries are dropped so a trailing comma in a
 * `.dev.vars` line cannot create a keyless provider.
 */
export function parseKeyList(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of values) {
    for (const part of (value ?? '').split(/[,\n;]+/)) {
      const key = part.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function normaliseProvider(raw: AiProviderConfig): AiProviderConfig {
  const kind: AiProviderKind =
    raw.kind === 'OLLAMA' || raw.kind === 'OPENAI' || raw.kind === 'OPENAI_COMPATIBLE' ? raw.kind : 'OLLAMA';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('aip', 8),
    label: (raw.label ?? '').trim() || 'Untitled provider',
    kind,
    baseUrl: normaliseBaseUrl(raw.baseUrl ?? '') || 'https://ollama.com/v1',
    model: (raw.model ?? '').trim(),
    ...(typeof raw.apiKey === 'string' && raw.apiKey ? { apiKey: raw.apiKey } : {}),
    enabled: raw.enabled !== false,
    requiresKey: raw.requiresKey !== false && !isLocalBaseUrl(raw.baseUrl ?? ''),
    isDefault: raw.isDefault === true,
    ...(raw.sttModel ? { sttModel: raw.sttModel } : {}),
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

/** Rewrites the provider list after an admin edit. Keys are carried over unless replaced. */
export async function saveProviders(
  env: Env,
  drafts: Array<Partial<AiProviderConfig> & { id?: string; apiKey?: string | null }>,
  actorUserId: string,
): Promise<AiProviderPublic[]> {
  const existing = await loadProviders(env);
  const byId = new Map(existing.map((provider) => [provider.id, provider]));
  const timestamp = nowIso();
  const next: AiProviderConfig[] = [];

  for (const draft of drafts) {
    const previous = draft.id ? byId.get(draft.id) : undefined;
    if (!draft.model || !draft.baseUrl) continue;
    const kind: AiProviderKind =
      draft.kind === 'OLLAMA' || draft.kind === 'OPENAI' || draft.kind === 'OPENAI_COMPATIBLE'
        ? draft.kind
        : (previous?.kind ?? 'OLLAMA');
    const apiKey =
      typeof draft.apiKey === 'string'
        ? draft.apiKey.trim() || undefined
        : previous?.apiKey;
    next.push({
      id: previous?.id ?? (draft.id && !draft.id.startsWith('env-') ? draft.id : newId('aip', 8)),
      label: (draft.label ?? previous?.label ?? 'Untitled provider').trim() || 'Untitled provider',
      kind,
      baseUrl: normaliseBaseUrl(draft.baseUrl),
      model: draft.model.trim(),
      ...(apiKey ? { apiKey } : {}),
      enabled: draft.enabled !== false,
      requiresKey:
        (draft.requiresKey ?? previous?.requiresKey ?? true) &&
        !isLocalBaseUrl(normaliseBaseUrl(draft.baseUrl)),
      isDefault: draft.isDefault === true,
      ...(draft.sttModel ? { sttModel: draft.sttModel } : {}),
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }

  // Exactly one default, and it must be enabled.
  if (next.length > 0 && !next.some((provider) => provider.isDefault)) next[0]!.isDefault = true;
  if (next.some((provider) => provider.isDefault && !provider.enabled)) {
    const fallback = next.find((provider) => provider.enabled) ?? null;
    for (const provider of next) provider.isDefault = provider === fallback;
  }

  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(AI_PROVIDERS_SETTING_KEY, JSON.stringify({ providers: next }), actorUserId, timestamp)
    .run();

  return next.map(toPublicProvider);
}

export interface ResolvedProvider {
  provider: AiProviderConfig;
  apiKey: string;
}

/** The provider that will be used, or a clear reason why none can be. */
export async function resolveProvider(env: Env, providerId?: string): Promise<ResolvedProvider> {
  const providers = await loadProviders(env);
  const usable = providers.filter((provider) => isUsable(provider));
  if (usable.length === 0) {
    throw new ApiError(
      'AI_UNAVAILABLE',
      providers.length === 0
        ? 'No AI provider is configured. An administrator can add one in Admin → Settings → AI providers (Ollama cloud, OpenAI or any OpenAI-compatible endpoint).'
        : 'No AI provider is usable: the configured providers are disabled, missing a model or missing an API key.',
    );
  }
  const chosen =
    (providerId ? usable.find((provider) => provider.id === providerId) : undefined) ??
    usable.find((provider) => provider.isDefault) ??
    usable[0]!;
  return { provider: chosen, apiKey: (chosen.apiKey ?? '').trim() };
}

/** Enabled, with a model, and with a key when its endpoint needs one. */
export function isUsable(provider: AiProviderConfig): boolean {
  if (!provider.enabled || !provider.model) return false;
  return providerNeedsKey(provider) ? Boolean((provider.apiKey ?? '').trim()) : true;
}

/** Status for the admin screens and for feature gates. Never contacts the network. */
export async function providerStatus(env: Env): Promise<AiStatus> {
  const providers = await loadProviders(env);
  const usable = providers.filter((provider) => isUsable(provider));
  if (usable.length === 0) {
    return {
      available: false,
      reason:
        providers.length === 0
          ? 'No AI provider is configured. Manual authoring and manual marking still work.'
          : 'Every configured AI provider is disabled or missing a key/model.',
    };
  }
  const chosen = usable.find((provider) => provider.isDefault) ?? usable[0]!;
  return {
    available: true,
    providerId: chosen.id,
    providerLabel: chosen.label,
    model: chosen.model,
    kind: chosen.kind,
    fromEnvironment: chosen.id === ENV_PROVIDER_ID,
  };
}

export async function listPublicProviders(env: Env): Promise<AiProviderPublic[]> {
  return (await loadProviders(env)).map(toPublicProvider);
}

// -----------------------------------------------------------------------------
// Chat completion
// -----------------------------------------------------------------------------

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or OpenAI-style content parts (text + images). */
  content: string | ChatContentPart[];
}

export interface CompletionRequest {
  messages: ChatMessage[];
  /** Provider id; the default provider is used when omitted. */
  providerId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object. The caller still validates the parsed result. */
  json?: boolean;
  /** JSON Schema used with providers that support strict structured output. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
}

/**
 * Only OpenAI's endpoint accepts image parts. For every other provider the
 * images are replaced by a note saying they were dropped, so a model is never
 * asked to describe a picture it cannot see.
 */
function normaliseMessageContent(content: string | ChatContentPart[], kind: AiProviderKind): string | ChatContentPart[] {
  if (typeof content === 'string') return content;
  if (kind === 'OPENAI') return content;
  const images = content.filter((part) => part.type === 'image_url').length;
  const text = content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n');
  return images > 0 ? `${text}\n\n[${images} image(s) omitted: this provider is text-only.]` : text;
}

export interface CompletionResult {
  text: string;
  provider: AiProviderConfig;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Posts one chat completion and returns the assistant text.
 *
 * Ollama, OpenAI and compatible gateways all expose `/chat/completions`, so a
 * single implementation serves every provider; `jsonSchema` is only attached for
 * OpenAI, where strict structured outputs are guaranteed.
 */
export async function completeChat(env: Env, request: CompletionRequest): Promise<CompletionResult> {
  const { provider } = await resolveProvider(env, request.providerId);

  // Failover: when an admin has added several providers (for example two Ollama
  // cloud keys with different rate limits), a rate-limited or rejected provider
  // is skipped and the next usable one answers the request. A caller that named
  // a provider explicitly still gets that provider first.
  const providers = await loadProviders(env);
  const usable = providers.filter((candidate) => isUsable(candidate));
  const ordered = [provider, ...usable.filter((candidate) => candidate.id !== provider.id)];
  let lastError: unknown = null;

  for (const candidate of ordered) {
    try {
      return await postChat(candidate, (candidate.apiKey ?? '').trim(), { ...request, providerId: undefined });
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof ApiError && (error.code === 'RATE_LIMITED' || error.code === 'AI_UNAVAILABLE');
      if (!retryable || ordered.length === 1) throw error;
      console.warn('ai_provider_failover', provider.id, '->', candidate.id, (error as ApiError).code);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No AI provider could answer the request.');
}

/** The transport shared by `completeChat` and the admin connection test. */
async function postChat(
  provider: AiProviderConfig,
  apiKey: string,
  request: CompletionRequest,
): Promise<CompletionResult> {
  const endpoint = buildProviderEndpoint(provider);

  const body: Record<string, unknown> = {
    model: provider.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: normaliseMessageContent(message.content, provider.kind),
    })),
    stream: false,
    temperature: request.temperature ?? 0.2,
  };
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  if (request.json) {
    if (provider.kind === 'OPENAI' && request.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema },
      };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
    });
  } catch (error) {
    const reason = (error as Error)?.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
    throw new ApiError(
      'AI_UNAVAILABLE',
      `The AI provider “${provider.label}” ${reason}. Check the base URL (${endpoint}) and try again.`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('ai_provider_error', provider.id, provider.kind, response.status, detail.slice(0, 400));
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        'AI_UNAVAILABLE',
        `The AI provider “${provider.label}” rejected the API key (status ${response.status}). Update the key in Admin → Settings → AI providers.`,
      );
    }
    if (response.status === 404) {
      // Ollama's hosted models carry a `-cloud` suffix. An admin who typed the
      // bare tag (`gpt-oss:120b`) gets one automatic retry with the suffix
      // rather than an error they cannot interpret.
      if (provider.kind === 'OLLAMA' && isOllamaCloudBaseUrl(provider.baseUrl) && cloudModelTag(provider.model) !== provider.model) {
        const retryModel = cloudModelTag(provider.model);
        console.warn('ai_provider_model_cloud_retry', provider.id, provider.model, retryModel);
        return postChat({ ...provider, model: retryModel }, apiKey, request);
      }
      throw new ApiError(
        'AI_UNAVAILABLE',
        `The AI provider “${provider.label}” does not offer the model “${provider.model}” (status 404). Check the model name.`,
      );
    }
    if (response.status === 429) {
      throw new ApiError('RATE_LIMITED', `The AI provider “${provider.label}” is rate limiting requests. Try again shortly.`);
    }
    throw new ApiError('AI_UNAVAILABLE', `The AI provider “${provider.label}” responded with status ${response.status}.`);
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        // Ollama's native surface uses these two fields; accepted as a fallback.
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      }
    | null;

  const content = payload?.choices?.[0]?.message?.content ?? payload?.message?.content ?? '';
  const text = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : content;
  if (!text.trim()) throw new ApiError('AI_UNAVAILABLE', `The AI provider “${provider.label}” returned an empty response.`);

  const usage = payload?.usage
    ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
    : payload?.prompt_eval_count != null
      ? { inputTokens: payload.prompt_eval_count, outputTokens: payload.eval_count }
      : undefined;

  return { text, provider, ...(usage ? { usage } : {}) };
}

/**
 * Chat completion that must produce a JSON object. The model is told to reply
 * with JSON only; the first balanced object in the reply is extracted so a
 * chatty model that adds a sentence before the JSON still works.
 */
export async function completeJson<T = unknown>(
  env: Env,
  request: Omit<CompletionRequest, 'json'>,
): Promise<{ data: T; provider: AiProviderConfig; usage?: CompletionResult['usage'] }> {
  const result = await completeChat(env, { ...request, json: true });
  const parsed = extractJson<T>(result.text);
  if (parsed === null) {
    throw new ApiError('AI_UNAVAILABLE', `The AI provider “${result.provider.label}” did not return valid JSON. Nothing was saved.`);
  }
  return { data: parsed, provider: result.provider, ...(result.usage ? { usage: result.usage } : {}) };
}

/** Extracts the first balanced JSON object/array from a possibly chatty reply. */
export function extractJson<T>(raw: string): T | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall through to brace matching.
  }
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** One tiny round trip used by the admin "Test connection" button. */
export async function testProvider(
  env: Env,
  draft: Pick<AiProviderConfig, 'id' | 'label' | 'kind' | 'baseUrl' | 'model' | 'apiKey'>,
): Promise<{ ok: boolean; message: string; latencyMs: number; reply?: string }> {
  const provider: AiProviderConfig = {
    id: draft.id || 'test',
    label: draft.label || 'Test provider',
    kind: draft.kind,
    baseUrl: normaliseBaseUrl(draft.baseUrl),
    model: draft.model,
    ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
    enabled: true,
    isDefault: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  // A brand-new provider is not in the database yet, so the draft carries the
  // key for this one request; nothing is persisted by a test.
  const stored = await loadProviders(env);
  const previous = stored.find((item) => item.id === provider.id);
  if (!provider.apiKey && !previous?.apiKey) {
    return { ok: false, message: 'Enter an API key before testing.', latencyMs: 0 };
  }
  const key = provider.apiKey || previous?.apiKey || '';

  const started = Date.now();
  try {
    const result = await postChat(provider, key, {
      messages: [
        { role: 'system', content: 'You are a connection test. Reply with exactly: OK' },
        { role: 'user', content: 'Reply with OK.' },
      ],
      maxTokens: 24,
      temperature: 0,
      timeoutMs: 30_000,
    });
    return { ok: true, message: `Connected to ${result.provider.model}.`, latencyMs: Date.now() - started, reply: result.text.trim().slice(0, 80) };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : (error as Error)?.message ?? 'Unknown error.';
    return { ok: false, message, latencyMs: Date.now() - started };
  }
}

/** Speech to text through an OpenAI-compatible `/audio/transcriptions` route. */
export async function transcribeWithProvider(env: Env, file: File, providerId?: string): Promise<string> {
  const { provider, apiKey } = await resolveProvider(env, providerId);
  if (!provider.sttModel) {
    throw new ApiError(
      'AI_UNAVAILABLE',
      `The AI provider “${provider.label}” has no speech-to-text model configured. Add one (for example whisper-1) in Admin → Settings → AI providers, or keep the browser transcript.`,
    );
  }
  const form = new FormData();
  form.append('file', file);
  form.append('model', provider.sttModel);
  form.append('response_format', 'json');

  const response = await fetch(buildTranscriptionEndpoint(provider), {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  }).catch(() => {
    throw new ApiError('AI_UNAVAILABLE', `The speech-to-text endpoint of “${provider.label}” could not be reached.`);
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('ai_transcribe_error', provider.id, response.status, detail.slice(0, 300));
    throw new ApiError('AI_UNAVAILABLE', `Speech-to-text failed for “${provider.label}” (status ${response.status}).`);
  }
  const payload = (await response.json().catch(() => null)) as { text?: string } | null;
  return payload?.text ?? '';
}
