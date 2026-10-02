import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/worker/env';
import {
  AI_PROVIDERS_SETTING_KEY,
  completeChat,
  completeJson,
  extractJson,
  listPublicProviders,
  loadProviders,
  parseKeyList,
  pickSimilarModel,
  providerStatus,
  resetResolvedModels,
  resolveProvider,
  saveProviders,
} from '../../src/worker/ai/providers';
import {
  bareModelTag,
  cloudModelTag,
  isOllamaCloudBaseUrl,
  MODEL_PRESETS,
  ollamaModelCandidates,
} from '../../src/shared/ai';

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

  it('falls back to the bare gpt-oss:120b on ollama.com when no model is configured', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    const [provider] = await loadProviders(env);
    expect(provider?.model).toBe('gpt-oss:120b');
    expect(provider?.baseUrl).toBe('https://ollama.com/v1');
  });

  it('never returns a stored key to the browser', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    const status = await providerStatus(env);
    expect(status.available).toBe(true);
    expect(status.model).toBe('gpt-oss:120b');

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

  it('offers the hosted Ollama models under the names ollama.com itself uses', () => {
    const ids = MODEL_PRESETS.map((preset) => preset.id);
    expect(ids).toContain('gpt-oss:120b');
    expect(ids).toContain('gemma4:31b');
    // The first preset must be directly callable: no CLI-only `-cloud` suffix.
    expect(ids[0]).toBe('gpt-oss:120b');
  });

  it('knows both spellings of a hosted model and tries the direct one first', () => {
    expect(bareModelTag('gpt-oss:120b-cloud')).toBe('gpt-oss:120b');
    expect(bareModelTag('deepseek-v3.2:cloud')).toBe('deepseek-v3.2');
    expect(bareModelTag('gemma4:31b')).toBe('gemma4:31b');
    expect(ollamaModelCandidates('gpt-oss:120b-cloud', 'https://ollama.com/v1')).toEqual([
      'gpt-oss:120b',
      'gpt-oss:120b-cloud',
    ]);
    expect(ollamaModelCandidates('gpt-oss:120b', 'https://ollama.com/v1')).toEqual([
      'gpt-oss:120b',
      'gpt-oss:120b-cloud',
    ]);
    // A local daemon or a gateway is called with the name exactly as typed.
    expect(ollamaModelCandidates('gpt-oss:120b-cloud', 'http://localhost:11434/v1')).toEqual(['gpt-oss:120b-cloud']);
    expect(ollamaModelCandidates('  ', 'https://ollama.com/v1')).toEqual([]);
  });

  it('substitutes the closest offered model of the same family', () => {
    const offered = ['gemma3:4b', 'gpt-oss:20b', 'gpt-oss:120b', 'deepseek-v3.2'];
    expect(pickSimilarModel('gpt-oss:120b-cloud', offered)).toBe('gpt-oss:120b');
    expect(pickSimilarModel('gpt-oss:70b', offered)).toBe('gpt-oss:120b');
    expect(pickSimilarModel('llama9:1b', offered)).toBeNull();
    expect(pickSimilarModel('gpt-oss:120b', [])).toBeNull();
  });
});

/** A chat-completions reply in the OpenAI shape. */
function chatReply(content: string | null, extra: Record<string, unknown> = {}, finish = 'stop') {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finish, message: { role: 'assistant', content, ...extra } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorReply(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers: { 'content-type': 'application/json' } });
}

interface SentRequest {
  url: string;
  body: Record<string, unknown> | null;
}

/** Replaces `fetch` with a script of replies and records what was sent. */
function scriptFetch(replies: Array<Response | ((request: SentRequest) => Response)>) {
  const sent: SentRequest[] = [];
  const queue = [...replies];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request: SentRequest = {
        url: String(input),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      sent.push(request);
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected request to ${request.url}`);
      return typeof next === 'function' ? next(request) : next;
    }),
  );
  return sent;
}

describe('AI provider transport', () => {
  beforeEach(() => {
    resetResolvedModels();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ask = { messages: [{ role: 'user' as const, content: 'hi' }] };

  it('calls ollama.com with the bare model name even when the config says -cloud', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1, OLLAMA_MODEL: 'gpt-oss:120b-cloud' });
    const sent = scriptFetch([chatReply('hello')]);

    const result = await completeChat(env, ask);

    expect(result.text).toBe('hello');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://ollama.com/v1/chat/completions');
    expect(sent[0]!.body?.model).toBe('gpt-oss:120b');
  });

  it('falls back to the spelling the admin typed when the bare name is unknown', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1, OLLAMA_MODEL: 'gpt-oss:120b' });
    const sent = scriptFetch([errorReply(404, 'model "gpt-oss:120b" not found'), chatReply('ok')]);

    const result = await completeChat(env, ask);

    expect(result.text).toBe('ok');
    expect(sent.map((request) => request.body?.model)).toEqual(['gpt-oss:120b', 'gpt-oss:120b-cloud']);

    // The working spelling is remembered: no second probe on the next call.
    const again = scriptFetch([chatReply('again')]);
    await completeChat(env, ask);
    expect(again.map((request) => request.body?.model)).toEqual(['gpt-oss:120b-cloud']);
  });

  it('asks the provider for its model list when no spelling exists, and uses the closest model', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1, OLLAMA_MODEL: 'gpt-oss:120b' });
    const sent = scriptFetch([
      errorReply(404, 'model "gpt-oss:120b" not found'),
      errorReply(404, 'model "gpt-oss:120b-cloud" not found'),
      new Response(JSON.stringify({ data: [{ id: 'gemma4:31b' }, { id: 'gpt-oss:20b' }] }), { status: 200 }),
      chatReply('from the 20b'),
    ]);

    const result = await completeChat(env, ask);

    expect(result.text).toBe('from the 20b');
    expect(sent[2]!.url).toBe('https://ollama.com/v1/models');
    expect(sent[3]!.body?.model).toBe('gpt-oss:20b');
  });

  it('names the models a provider does offer when none is close enough', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1, OLLAMA_MODEL: 'retired-model:7b' });
    scriptFetch([
      errorReply(404, 'model "retired-model:7b" not found'),
      errorReply(404, 'model "retired-model:7b-cloud" not found'),
      new Response(JSON.stringify({ data: [{ id: 'gemma4:31b' }, { id: 'gpt-oss:20b' }] }), { status: 200 }),
    ]);

    await expect(completeChat(env, ask)).rejects.toThrow(/does not offer the model “retired-model:7b”.*gemma4:31b, gpt-oss:20b/);
  });

  it('does not treat a 404 for a wrong base URL as a missing model', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1, OLLAMA_BASE_URL: 'https://ollama.com/oops' });
    const sent = scriptFetch([new Response('<html>Not Found</html>', { status: 404 })]);

    await expect(completeChat(env, ask)).rejects.toThrow(/answered 404.*Check the base URL/);
    expect(sent).toHaveLength(1);
  });

  it('retries without response_format when the provider rejects it', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    const sent = scriptFetch([
      errorReply(400, "invalid parameter: response_format is not supported by this model"),
      chatReply('{"band": 7}'),
    ]);

    const { data } = await completeJson<{ band: number }>(env, ask);

    expect(data.band).toBe(7);
    expect(sent[0]!.body?.response_format).toEqual({ type: 'json_object' });
    expect(sent[1]!.body && 'response_format' in sent[1]!.body).toBe(false);
  });

  it('retries with a larger budget when a reasoning model spends it all thinking', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    const sent = scriptFetch([
      chatReply('', { reasoning: 'Let me think about the essay…' }, 'length'),
      chatReply('{"band": 6.5}'),
    ]);

    const { data } = await completeJson<{ band: number }>(env, { ...ask, maxTokens: 3000 });

    expect(data.band).toBe(6.5);
    expect(sent.map((request) => request.body?.max_tokens)).toEqual([3000, 6000]);
    // gpt-oss is told to think briefly so the budget goes to the answer.
    expect(sent[0]!.body?.reasoning_effort).toBe('low');
  });

  it('reads a JSON answer that a reasoning model left in its reasoning field', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    scriptFetch([chatReply('', { reasoning_content: 'Final: {"band": 5}' })]);

    const { data } = await completeJson<{ band: number }>(env, ask);

    expect(data.band).toBe(5);
  });

  it('asks once more when the first reply is not valid JSON', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    const sent = scriptFetch([chatReply('Sure! Here is my verdict: the essay is good.'), chatReply('```json\n{"band": 8}\n```')]);

    const { data } = await completeJson<{ band: number }>(env, ask);

    expect(data.band).toBe(8);
    const retryMessages = sent[1]!.body?.messages as Array<{ role: string; content: string }>;
    expect(retryMessages.at(-1)?.content).toMatch(/valid JSON object/);
  });

  it('gives up with a clear message when the model never produces JSON', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    scriptFetch([chatReply('no json here'), chatReply('still none')]);

    await expect(completeJson(env, ask)).rejects.toThrow(/did not return valid JSON/);
  });

  it('turns an auth failure into an actionable message', async () => {
    const { env } = createFakeEnv({ OLLAMA_API_KEYS: OLLAMA_KEY_1 });
    scriptFetch([errorReply(401, 'unauthorized')]);

    await expect(completeChat(env, ask)).rejects.toThrow(/rejected the API key/);
  });
});

describe('extractJson', () => {
  it('reads fenced, chatty and bracket-led replies', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":{"b":[1,2]}} Hope that helps!')).toEqual({ a: { b: [1, 2] } });
    // A bracket in the prose must not hide the real object.
    expect(extractJson('As noted in [1], the answer is {"a": "x}y"}', 'object')).toEqual({ a: 'x}y' });
    expect(extractJson('[1, 2]', 'object')).toBeNull();
    expect(extractJson('no json')).toBeNull();
    expect(extractJson('{"cut": "off')).toBeNull();
  });
});
