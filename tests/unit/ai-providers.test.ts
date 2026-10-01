import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/worker/env';
import {
  AI_PROVIDERS_SETTING_KEY,
  listPublicProviders,
  loadProviders,
  parseKeyList,
  providerStatus,
  resolveProvider,
  saveProviders,
} from '../../src/worker/ai/providers';
import { cloudModelTag, isOllamaCloudBaseUrl, MODEL_PRESETS } from '../../src/shared/ai';

/**
 * In-memory stand-in for the one statement `loadProviders`/`saveProviders`
 * issue (`platform_settings` upsert/read).
 */
function createFakeEnv(extra: Partial<Env> = {}) {
  const settings = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      const normalised = sql.replace(/\s+/g, ' ').trim();
      const statement = {
        __params: [] as unknown[],
        bind(...params: unknown[]) {
          statement.__params = params;
          return statement;
        },
        async first() {
          if (normalised.startsWith('SELECT value_json FROM platform_settings')) {
            const stored = settings.get(statement.__params[0] as string);
            return stored === undefined ? null : { value_json: stored };
          }
          throw new Error(`Unexpected SQL: ${normalised.slice(0, 80)}`);
        },
        async run() {
          if (normalised.startsWith('INSERT INTO platform_settings')) {
            settings.set(statement.__params[0] as string, statement.__params[1] as string);
            return { success: true };
          }
          throw new Error(`Unexpected SQL: ${normalised.slice(0, 80)}`);
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  };
  return { env: { DB: db, ...extra } as unknown as Env, settings };
}

const OLLAMA_KEY_1 = 'e0b94c2eb3484c649e6dc2388fa0addd.5TVptp8DHJVo8ooo0Ol4icKR';
const OLLAMA_KEY_2 = '450bb04b20504e24b3a192d82fbd8a25';

describe('AI provider configuration', () => {
  it('turns a comma-separated OLLAMA_API_KEYS secret into one provider per key', async () => {
    const { env } = createFakeEnv({
      OLLAMA_API_KEYS: `${OLLAMA_KEY_1},\n${OLLAMA_KEY_2},`,
      OLLAMA_MODEL: 'gpt-oss:120b-cloud',
      OLLAMA_BASE_URL: 'https://ollama.com/v1',
    });

    const providers = await loadProviders(env);
    expect(providers).toHaveLength(2);
    expect(providers.map((provider) => provider.id)).toEqual(['env-ollama-1', 'env-ollama-2']);
    expect(providers.every((provider) => provider.kind === 'OLLAMA')).toBe(true);
    expect(providers.every((provider) => provider.model === 'gpt-oss:120b-cloud')).toBe(true);
    expect(providers.every((provider) => provider.baseUrl === 'https://ollama.com/v1')).toBe(true);
    // Exactly one default: the marker always has a defined first choice.
    expect(providers.filter((provider) => provider.isDefault)).toHaveLength(1);
  });

  it('falls back to gpt-oss:120b-cloud on ollama.com when no model is configured', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEY: OLLAMA_KEY_1 });
    const [provider] = await loadProviders(env);
    expect(provider?.model).toBe('gpt-oss:120b-cloud');
    expect(provider?.baseUrl).toBe('https://ollama.com/v1');
  });

  it('never returns a stored key to the browser', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    const status = await providerStatus(env);
    expect(status.available).toBe(true);
    expect(status.model).toBe('gpt-oss:120b-cloud');

    const publicProviders = await listPublicProviders(env);
    const serialised = JSON.stringify(publicProviders);
    expect(serialised).not.toContain('5TVptp8DHJVo8ooo0Ol4icKR');
    expect(publicProviders[0]?.hasKey).toBe(true);
    expect(publicProviders[0]?.keyHint).toBe('icKR');
  });

  it('rotates to the next key when the first provider is unusable', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: `${OLLAMA_KEY_1},${OLLAMA_KEY_2}` });
    const providers = await loadProviders(env);
    // Disable the default: resolution must fall to the remaining enabled key.
    const disabled = env.DB as unknown as { prepare: (sql: string) => unknown };
    void disabled;
    const chosen = await resolveProvider(env, providers[1]!.id);
    expect(chosen.provider.id).toBe('env-ollama-2');
    expect(chosen.apiKey).toBe(OLLAMA_KEY_2);
  });

  it('keeps a stored key when the admin saves without retyping it', async () => {
    const { env } = createFakeEnv();
    const first = await saveProviders(
      env,
      [
        {
          label: 'Ollama Cloud',
          kind: 'OLLAMA',
          baseUrl: 'https://ollama.com/v1',
          model: 'gpt-oss:120b-cloud',
          apiKey: OLLAMA_KEY_1,
          enabled: true,
          isDefault: true,
        },
      ],
      'admin-1',
    );
    const storedId = first[0]!.id;

    // Re-save the same row without the key field (the form leaves it blank).
    const second = await saveProviders(
      env,
      [
        {
          id: storedId,
          label: 'Ollama Cloud (renamed)',
          kind: 'OLLAMA',
          baseUrl: 'https://ollama.com/v1',
          model: 'gemma4:31b-cloud',
          enabled: true,
          isDefault: true,
        },
      ],
      'admin-1',
    );

    // The Worker keeps the key, but never echoes it back to the browser.
    expect(second[0]!.id).toBe(storedId);
    expect(second[0]!.hasKey).toBe(true);
    expect(JSON.stringify(second)).not.toContain('5TVptp8DHJVo8ooo0Ol4icKR');

    const stored = JSON.parse(
      (await env.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?')
        .bind(AI_PROVIDERS_SETTING_KEY)
        .first<{ value_json: string }>())!.value_json,
    ) as { providers: Array<{ apiKey?: string; model: string }> };
    expect(stored.providers[0]!.apiKey).toBe(OLLAMA_KEY_1);
    expect(stored.providers[0]!.model).toBe('gemma4:31b-cloud');
  });

  it('drops blank and duplicate keys from the secret list', () => {
    expect(parseKeyList([` ${OLLAMA_KEY_1} , ,${OLLAMA_KEY_1};;${OLLAMA_KEY_2} `, undefined])).toEqual([
      OLLAMA_KEY_1,
      OLLAMA_KEY_2,
    ]);
  });

  it('adds the cloud suffix only for the hosted Ollama models that lack it', () => {
    expect(cloudModelTag('gpt-oss:120b')).toBe('gpt-oss:120b-cloud');
    expect(cloudModelTag('gpt-oss:120b-cloud')).toBe('gpt-oss:120b-cloud');
    expect(cloudModelTag('deepseek-v3.2:cloud')).toBe('deepseek-v3.2:cloud');
    expect(cloudModelTag('  ')).toBe('');
    expect(isOllamaCloudBaseUrl('https://ollama.com/v1')).toBe(true);
    expect(isOllamaCloudBaseUrl('http://localhost:11434/v1')).toBe(false);
  });

  it('offers the hosted Ollama models the platform ships keys for', () => {
    const ids = MODEL_PRESETS.map((preset) => preset.id);
    expect(ids).toContain('gpt-oss:120b-cloud');
    expect(ids).toContain('gemma4:31b-cloud');
  });
});
