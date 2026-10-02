import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import {
  bareModelTag,
  buildModelsEndpoint,
  buildProviderEndpoint,
  buildTranscriptionEndpoint,
  isLocalBaseUrl,
  normaliseBaseUrl,
  ollamaModelCandidates,
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
/** Bare name: a direct request to ollama.com does not use the CLI's `-cloud` suffix. */
export const DEFAULT_OLLAMA_MODEL = 'gpt-oss:120b';
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
      model: (env.OLLAMA_MODEL ?? '').trim() || DEFAULT_OLLAMA_MODEL,
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
  /**
   * Use this model instead of the provider's configured one. This is how the
   * judging panel runs two different models through the same endpoint and key.
   */
  model?: string;
  /** How long a reasoning model may think before it answers (gpt-oss family). Default `low`. */
  reasoningEffort?: 'low' | 'medium' | 'high';
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
  /** The model stopped because it ran out of output tokens, so JSON may be cut off. */
  truncated?: boolean;
}

/** Upper bound for the automatic "the model ran out of tokens" retry. */
const MAX_TOKEN_CEILING = 16_000;

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
  // A model override only makes sense on the same kind of endpoint (a Gemma tag sent to OpenAI is a 404).
  const ordered = [
    provider,
    ...usable.filter((candidate) => candidate.id !== provider.id && (!request.model || candidate.kind === provider.kind)),
  ];
  let lastError: unknown = null;

  for (const candidate of ordered) {
    try {
      const target = request.model?.trim() ? { ...candidate, model: request.model.trim() } : candidate;
      return await postChat(target, (candidate.apiKey ?? '').trim(), { ...request, providerId: undefined });
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

/** The spellings of a provider's model worth trying (see `ollamaModelCandidates`). */
function modelCandidatesFor(provider: AiProviderConfig): string[] {
  if (provider.kind === 'OLLAMA') return ollamaModelCandidates(provider.model, provider.baseUrl);
  return [provider.model.trim()].filter(Boolean);
}

/**
 * The model spelling that worked last time for an endpoint, so the "try the bare
 * name, then the suffixed one" probing costs round trips once per isolate only.
 */
const resolvedModels = new Map<string, string>();
const resolvedKey = (provider: AiProviderConfig) => `${provider.baseUrl}|${provider.model}`;

/** Test hook: forget which model spelling worked, so each test probes from scratch. */
export function resetResolvedModels(): void {
  resolvedModels.clear();
}

type ChatAttempt = { kind: 'ok'; result: CompletionResult } | { kind: 'model-not-found' };

interface AttemptTweaks {
  /** The provider rejected `response_format`; ask for JSON in the prompt only. */
  dropJsonFormat?: boolean;
  /** Raised after a reasoning model spent its whole budget thinking. */
  maxTokens?: number;
}

/** The transport shared by `completeChat` and the admin connection test. */
async function postChat(
  provider: AiProviderConfig,
  apiKey: string,
  request: CompletionRequest,
): Promise<CompletionResult> {
  const remembered = resolvedModels.get(resolvedKey(provider));
  const candidates = [...new Set([...(remembered ? [remembered] : []), ...modelCandidatesFor(provider)])];

  for (const model of candidates) {
    const attempt = await attemptChat({ ...provider, model }, apiKey, request);
    if (attempt.kind === 'ok') {
      if (model !== provider.model) console.warn('ai_provider_model_resolved', provider.id, provider.model, '->', model);
      resolvedModels.set(resolvedKey(provider), model);
      return attempt.result;
    }
  }

  // None of the spellings exists. Ask the provider what it does offer, so a
  // renamed or retired model is replaced by the closest one instead of failing.
  const offered = await listProviderModels(provider, apiKey);
  const similar = pickSimilarModel(provider.model, offered);
  if (similar && !candidates.includes(similar)) {
    const attempt = await attemptChat({ ...provider, model: similar }, apiKey, request);
    if (attempt.kind === 'ok') {
      console.warn('ai_provider_model_substituted', provider.id, provider.model, '->', similar);
      resolvedModels.set(resolvedKey(provider), similar);
      return attempt.result;
    }
  }

  const sample = offered.slice(0, 8).join(', ');
  throw new ApiError(
    'AI_UNAVAILABLE',
    `The AI provider “${provider.label}” does not offer the model “${provider.model}”.${
      sample ? ` It offers: ${sample}.` : ''
    } Update the model in Admin → Settings → AI providers.`,
  );
}

async function attemptChat(
  provider: AiProviderConfig,
  apiKey: string,
  request: CompletionRequest,
  tweaks: AttemptTweaks = {},
): Promise<ChatAttempt> {
  const endpoint = buildProviderEndpoint(provider);
  const maxTokens = tweaks.maxTokens ?? request.maxTokens;

  const body: Record<string, unknown> = {
    model: provider.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: normaliseMessageContent(message.content, provider.kind),
    })),
    stream: false,
    temperature: request.temperature ?? 0.2,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (request.json && !tweaks.dropJsonFormat) {
    if (provider.kind === 'OPENAI' && request.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema },
      };
    } else {
      body.response_format = { type: 'json_object' };
    }
  }
  // gpt-oss thinks before it answers and thinking tokens count against
  // `max_tokens`. Keep the thinking short so the budget goes to the reply.
  if (provider.kind === 'OLLAMA' && /gpt-oss/i.test(provider.model)) body.reasoning_effort = request.reasoningEffort ?? 'low';

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
    console.error('ai_provider_error', provider.id, provider.kind, provider.model, response.status, detail.slice(0, 400));
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        'AI_UNAVAILABLE',
        `The AI provider “${provider.label}” rejected the API key (status ${response.status}). Update the key in Admin → Settings → AI providers.`,
      );
    }
    if (response.status === 400 && request.json && !tweaks.dropJsonFormat && /response_format|json_schema|json_object|format/i.test(detail)) {
      // Not every OpenAI-compatible gateway implements `response_format`. The
      // prompt already demands JSON, so ask again without it.
      console.warn('ai_provider_json_format_unsupported', provider.id, provider.model);
      return attemptChat(provider, apiKey, request, { ...tweaks, dropJsonFormat: true });
    }
    if (response.status === 404) {
      // "model not found" is recoverable (see `postChat`); a 404 for any other
      // reason means the base URL itself is wrong.
      if (/model/i.test(detail)) return { kind: 'model-not-found' };
      throw new ApiError(
        'AI_UNAVAILABLE',
        `The AI provider “${provider.label}” answered 404 at ${endpoint}. Check the base URL.`,
      );
    }
    if (response.status === 429) {
      throw new ApiError('RATE_LIMITED', `The AI provider “${provider.label}” is rate limiting requests. Try again shortly.`);
    }
    const reason = upstreamReason(detail);
    throw new ApiError(
      'AI_UNAVAILABLE',
      `The AI provider “${provider.label}” responded with status ${response.status}${reason ? `: ${reason}` : ''}.`,
    );
  }

  const payload = (await response.json().catch(() => null)) as ChatPayload | null;
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const content = message?.content ?? payload?.message?.content ?? '';
  let text = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : (content ?? '');
  const reasoning = message?.reasoning ?? message?.reasoning_content ?? payload?.message?.thinking ?? '';
  const finishReason = choice?.finish_reason ?? payload?.done_reason ?? null;
  const truncated = finishReason === 'length';

  if (!text.trim()) {
    // A reasoning model can spend the whole budget thinking and return nothing.
    const budget = maxTokens ?? 0;
    if (truncated && budget > 0 && budget < MAX_TOKEN_CEILING) {
      console.warn('ai_provider_reasoning_budget', provider.id, provider.model, budget);
      return attemptChat(provider, apiKey, request, { ...tweaks, maxTokens: Math.min(MAX_TOKEN_CEILING, budget * 2) });
    }
    if (request.json && reasoning.trim() && extractJson(reasoning, 'object') !== null) {
      text = reasoning;
    } else {
      throw new ApiError(
        'AI_UNAVAILABLE',
        `The AI provider “${provider.label}” returned an empty response${
          truncated ? ' (the model used all its output tokens while thinking)' : ''
        }.`,
      );
    }
  }

  const usage = payload?.usage
    ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens }
    : payload?.prompt_eval_count != null
      ? { inputTokens: payload.prompt_eval_count, outputTokens: payload.eval_count }
      : undefined;

  return { kind: 'ok', result: { text, provider, truncated, ...(usage ? { usage } : {}) } };
}

interface ChatPayload {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ text?: string }> | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  // Ollama's native surface uses these fields; accepted as a fallback.
  message?: { content?: string; thinking?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** A short, key-free reason taken from an upstream error body. */
function upstreamReason(detail: string): string {
  if (!detail) return '';
  let message = detail;
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string; message?: string };
    message =
      typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message ?? detail);
  } catch {
    // Not JSON (an HTML gateway page, for instance): do not echo markup.
    if (/^\s*</.test(detail)) return '';
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** The provider's own model list (`GET …/models`); empty when it cannot be read. */
async function listProviderModels(provider: AiProviderConfig, apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(buildModelsEndpoint(provider), {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as
      | { data?: Array<{ id?: string }>; models?: Array<{ name?: string; model?: string }> }
      | null;
    const ids = [
      ...(payload?.data ?? []).map((item) => item.id ?? ''),
      ...(payload?.models ?? []).map((item) => item.model ?? item.name ?? ''),
    ];
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/**
 * The offered model closest to the configured one: an exact match once the
 * `-cloud` suffix is ignored, else the largest model of the same family
 * (`gpt-oss:…`). Null when the family is not offered at all.
 */
export function pickSimilarModel(configured: string, offered: string[]): string | null {
  const wanted = bareModelTag(configured).toLowerCase();
  if (!wanted || offered.length === 0) return null;
  const exact = offered.find((id) => bareModelTag(id).toLowerCase() === wanted);
  if (exact) return exact;
  const family = wanted.split(':')[0]!;
  const siblings = offered.filter((id) => bareModelTag(id).toLowerCase().split(':')[0] === family);
  if (siblings.length === 0) return null;
  const size = (id: string) => Number(/(\d+(?:\.\d+)?)b\b/i.exec(id)?.[1] ?? 0);
  return [...siblings].sort((a, b) => size(b) - size(a))[0] ?? null;
}

/**
 * Chat completion that must produce a JSON object. The model is told to reply
 * with JSON only; the first balanced object in the reply is extracted so a
 * chatty model that adds a sentence before the JSON still works. One corrective
 * retry is made when the reply cannot be parsed (a cut-off reply is retried with
 * a larger token budget).
 */
export async function completeJson<T = unknown>(
  env: Env,
  request: Omit<CompletionRequest, 'json'>,
): Promise<{ data: T; provider: AiProviderConfig; usage?: CompletionResult['usage'] }> {
  let result = await completeChat(env, { ...request, json: true });
  let parsed = extractJsonObject<T>(result.text);

  if (parsed === null) {
    console.warn('ai_provider_invalid_json', result.provider.id, result.provider.model, result.truncated ? 'truncated' : 'malformed');
    const budget = request.maxTokens ?? 0;
    result = await completeChat(env, {
      ...request,
      json: true,
      providerId: result.provider.id,
      ...(budget > 0 ? { maxTokens: Math.min(MAX_TOKEN_CEILING, result.truncated ? budget * 2 : budget) } : {}),
      messages: [
        ...request.messages,
        { role: 'assistant', content: result.text.slice(0, 3_000) },
        {
          role: 'user',
          content: 'That was not one complete, valid JSON object. Reply again with ONLY the JSON object: no prose, no markdown fences.',
        },
      ],
    });
    parsed = extractJsonObject<T>(result.text);
  }

  if (parsed === null) {
    throw new ApiError('AI_UNAVAILABLE', `The AI provider “${result.provider.label}” did not return valid JSON. Nothing was saved.`);
  }
  return { data: parsed, provider: result.provider, ...(result.usage ? { usage: result.usage } : {}) };
}

/** Like `extractJson`, but only an object counts (never an array, string or number). */
function extractJsonObject<T>(raw: string): T | null {
  return extractJson<T>(raw, 'object');
}

/**
 * Extracts the first parseable JSON document from a possibly chatty reply: a
 * bare document, a fenced block, or one buried in prose. Several opening
 * brackets are tried in turn, so prose such as "see [1]" before the real object
 * does not hide it. With `kind: 'object'` only `{…}` documents qualify.
 */
export function extractJson<T>(raw: string, kind: 'any' | 'object' = 'any'): T | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const accepts = (value: unknown) =>
    kind === 'any' || (value !== null && typeof value === 'object' && !Array.isArray(value));

  try {
    const whole = JSON.parse(text) as unknown;
    if (accepts(whole)) return whole as T;
  } catch {
    // Fall through to bracket matching.
  }

  const opener = kind === 'object' ? /\{/ : /[[{]/;
  let from = 0;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const offset = text.slice(from).search(opener);
    if (offset === -1) return null;
    const begin = from + offset;
    const end = balancedEnd(text, begin);
    if (end !== -1) {
      try {
        const value = JSON.parse(text.slice(begin, end + 1)) as unknown;
        if (accepts(value)) return value as T;
      } catch {
        // Not JSON after all; try the next bracket.
      }
    }
    from = begin + 1;
  }
  return null;
}

/** Index of the bracket closing the one at `start`, ignoring brackets inside strings; -1 if unbalanced. */
function balancedEnd(text: string, start: number): number {
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
      if (depth === 0) return index;
    }
  }
  return -1;
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
      maxTokens: 256,
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
