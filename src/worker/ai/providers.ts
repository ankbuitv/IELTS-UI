import type { Env } from '../env';

/**
 * Multi-provider AI configuration.
 *
 * The platform no longer depends on a single OpenAI key. An administrator can
 * register any number of providers:
 *   - `openai`             → OpenAI's hosted API (default base https://api.openai.com/v1)
 *   - `openai-compatible`  → any OpenAI-compatible endpoint (Chutes, Groq,
 *                            OpenRouter, a self-hosted vLLM/SGLang server, …)
 *   - `ollama`            → a local/remote Ollama server (native /api/chat)
 *
 * Providers are resolved from (in priority order):
 *   1. the `ai_providers` platform setting (admin-managed via the UI), or
 *   2. the `AI_PROVIDERS` environment variable (a JSON array), or
 *   3. a legacy `OPENAI_API_KEY` environment variable.
 *
 * API keys are never returned to the browser: the admin UI receives a masked
 * value and the grading/structuring endpoints run only on the server.
 */

export type AiProviderKind = 'openai' | 'openai-compatible' | 'ollama';

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  /** Base URL for the API. Filled with a sensible default per kind when omitted. */
  baseUrl?: string | null;
  /** Secret API key. Optional for local Ollama. Never returned to the browser. */
  apiKey?: string | null;
  /** Model identifier, e.g. gpt-4.1, openai/gpt-oss-120b, gpt-oss:120b, gemma4:31b. */
  model: string;
  isDefault?: boolean;
}

export interface AiProviderSummary {
  id: string;
  name: string;
  kind: AiProviderKind;
  model: string;
  isDefault: boolean;
}

export interface MaskedProvider extends AiProviderSummary {
  baseUrl: string;
  apiKeyMasked: string;
}

export interface AiStatus {
  available: boolean;
  model?: string;
  reason?: string;
  providerCount?: number;
  defaultProviderId?: string;
  /** Usable providers (never contains secrets). */
  providers?: AiProviderSummary[];
}

const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';
const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

const PROVIDER_KINDS: readonly AiProviderKind[] = ['openai', 'openai-compatible', 'ollama'];

export function defaultBaseUrl(kind: AiProviderKind): string {
  if (kind === 'openai') return OPENAI_DEFAULT_BASE;
  if (kind === 'ollama') return OLLAMA_DEFAULT_BASE;
  return '';
}

export function isProviderUsable(provider: AiProvider): boolean {
  if (provider.kind === 'ollama') return Boolean(provider.baseUrl);
  return Boolean(provider.apiKey);
}

/**
 * Coerces an unknown record into a validated AiProvider. Returns null when the
 * record cannot form a usable provider (missing model, unknown kind, …).
 */
export function normaliseProvider(raw: unknown): AiProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const kind: AiProviderKind = PROVIDER_KINDS.includes(record.kind as AiProviderKind)
    ? (record.kind as AiProviderKind)
    : 'openai-compatible';

  const model = typeof record.model === 'string' && record.model.trim() ? record.model.trim() : '';
  if (!model) return null;

  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : `p_${Math.random().toString(36).slice(2, 10)}`;
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : model;
  const baseUrl =
    typeof record.baseUrl === 'string' && record.baseUrl.trim() ? record.baseUrl.trim() : defaultBaseUrl(kind);
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey : null;
  const isDefault = record.isDefault === true;

  return { id, name, kind, baseUrl, apiKey, model, isDefault };
}

export function parseAiProvidersJson(raw: unknown): AiProvider[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let text = raw.trim();
  // Some `.dev.vars` parsers deliver the value still wrapped in double quotes
  // (with inner quotes escaped as \"); unwrap and unescape so JSON.parse sees
  // clean JSON regardless of how the environment was loaded.
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).replace(/\\"/g, '"');
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normaliseProvider).filter((provider): provider is AiProvider => provider !== null);
  } catch {
    return [];
  }
}

/** Providers stored in the database by the admin UI (authoritative when present). */
export async function loadDbProviders(env: Env): Promise<AiProvider[] | null> {
  const row = await env.DB.prepare(
    "SELECT value_json FROM platform_settings WHERE key = 'ai_providers'",
  ).first<{ value_json: string }>();
  if (!row) return null;
  const parsed = parseAiProvidersJson(row.value_json);
  return parsed.length > 0 ? parsed : null;
}

/** Providers derived from environment variables (fallback when the DB is empty). */
export function envProviders(env: Env): AiProvider[] {
  const fromJson = parseAiProvidersJson(env.AI_PROVIDERS);
  if (fromJson.length > 0) return fromJson;

  if (env.OPENAI_API_KEY) {
    return [
      {
        id: 'openai-default',
        name: 'OpenAI',
        kind: 'openai',
        baseUrl: OPENAI_DEFAULT_BASE,
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL || 'gpt-4.1',
        isDefault: true,
      },
    ];
  }
  return [];
}

/**
 * The effective provider list: database-backed providers win so the admin UI is
 * the primary management surface; environment variables are the fallback.
 */
export async function resolveAiProviders(env: Env): Promise<AiProvider[]> {
  const db = await loadDbProviders(env);
  if (db && db.length > 0) return db;
  return envProviders(env);
}

export function selectProvider(providers: AiProvider[], providerId?: string | null): AiProvider | null {
  const usable = providers.filter(isProviderUsable);
  if (usable.length === 0) return null;
  if (providerId) {
    const byId = usable.find((provider) => provider.id === providerId);
    if (byId) return byId;
  }
  const def = usable.find((provider) => provider.isDefault);
  if (def) return def;
  return usable[0]!;
}

export function aiStatusFromProviders(providers: AiProvider[]): AiStatus {
  const usable = providers.filter(isProviderUsable);
  const def = selectProvider(providers);
  if (!def) {
    return {
      available: false,
      reason:
        'No AI provider is configured. Add an OpenAI or Ollama-compatible provider in Settings → AI providers, ' +
        'or set the AI_PROVIDERS environment variable.',
      providerCount: providers.length,
    };
  }
  return {
    available: true,
    model: def.model,
    defaultProviderId: def.id,
    providerCount: usable.length,
    providers: usable.map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      model: provider.model,
      isDefault: Boolean(provider.isDefault),
    })),
  };
}

export function maskApiKey(key?: string | null): string {
  if (!key) return '';
  if (key.length <= 6) return '••••';
  return `••••${key.slice(-4)}`;
}

export function toMaskedProvider(provider: AiProvider): MaskedProvider {
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl ?? defaultBaseUrl(provider.kind),
    model: provider.model,
    isDefault: Boolean(provider.isDefault),
    apiKeyMasked: maskApiKey(provider.apiKey),
  };
}

/** Merge incoming provider edits with the stored keys so unchanged keys are kept. */
export function mergeProviderSecrets(incoming: AiProvider[], existing: AiProvider[]): AiProvider[] {
  const byId = new Map(existing.map((provider) => [provider.id, provider]));
  return incoming.map((provider) => {
    const hasKey = Boolean(provider.apiKey && provider.apiKey !== '__unchanged__');
    if (hasKey) return provider;
    const stored = byId.get(provider.id);
    if (stored?.apiKey) return { ...provider, apiKey: stored.apiKey };
    return provider;
  });
}
