import { describe, expect, it } from 'vitest';
import {
  aiStatusFromProviders,
  defaultBaseUrl,
  isProviderUsable,
  maskApiKey,
  mergeProviderSecrets,
  normaliseProvider,
  parseAiProvidersJson,
  selectProvider,
  type AiProvider,
} from '../../src/worker/ai/providers';

describe('ai providers — normaliseProvider', () => {
  it('fills defaults for an openai-compatible provider', () => {
    const provider = normaliseProvider({ kind: 'openai-compatible', model: 'gpt-oss:120b' });
    expect(provider).not.toBeNull();
    expect(provider!.kind).toBe('openai-compatible');
    expect(provider!.baseUrl).toBe('');
    expect(provider!.model).toBe('gpt-oss:120b');
  });

  it('defaults ollama base URL to localhost', () => {
    const provider = normaliseProvider({ kind: 'ollama', model: 'llama3' });
    expect(provider!.baseUrl).toBe('http://localhost:11434');
  });

  it('rejects a provider with no model', () => {
    expect(normaliseProvider({ kind: 'openai-compatible' })).toBeNull();
  });

  it('falls back to openai-compatible for unknown kinds', () => {
    const provider = normaliseProvider({ model: 'x', kind: 'something-else' });
    expect(provider!.kind).toBe('openai-compatible');
  });
});

describe('ai providers — parseAiProvidersJson', () => {
  it('parses a JSON array of providers', () => {
    const result = parseAiProvidersJson(
      JSON.stringify([
        { id: 'a', name: 'A', kind: 'openai-compatible', model: 'm1', apiKey: 'k1' },
        { model: 'm2' },
      ]),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.apiKey).toBe('k1');
  });

  it('returns an empty array for invalid JSON', () => {
    expect(parseAiProvidersJson('not json')).toEqual([]);
    expect(parseAiProvidersJson('')).toEqual([]);
  });
});

describe('ai providers — isProviderUsable', () => {
  it('ollama is usable with a base URL even without a key', () => {
    expect(isProviderUsable({ id: 'o', name: 'O', kind: 'ollama', baseUrl: 'http://x:11434', model: 'm' })).toBe(true);
  });

  it('openai-compatible is not usable without a key', () => {
    expect(isProviderUsable({ id: 'c', name: 'C', kind: 'openai-compatible', baseUrl: 'https://x', model: 'm' })).toBe(false);
  });
});

describe('ai providers — aiStatusFromProviders', () => {
  it('reports unavailable when nothing is usable', () => {
    const status = aiStatusFromProviders([{ id: 'c', name: 'C', kind: 'openai-compatible', model: 'm' }]);
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/No AI provider/i);
  });

  it('reports available with the default model', () => {
    const status = aiStatusFromProviders([
      { id: 'c', name: 'C', kind: 'openai-compatible', model: 'gpt-oss:120b', apiKey: 'k', isDefault: true },
    ]);
    expect(status.available).toBe(true);
    expect(status.model).toBe('gpt-oss:120b');
    expect(status.providers).toHaveLength(1);
    expect(status.providers![0]!.model).toBe('gpt-oss:120b');
  });
});

describe('ai providers — selectProvider', () => {
  const providers: AiProvider[] = [
    { id: 'o', name: 'OpenAI', kind: 'openai', model: 'gpt-4.1', apiKey: 'k' },
    { id: 'c', name: 'Chutes', kind: 'openai-compatible', model: 'gpt-oss:120b', apiKey: 'k', isDefault: true },
  ];

  it('selects by id', () => {
    expect(selectProvider(providers, 'o')!.id).toBe('o');
  });

  it('falls back to the default', () => {
    expect(selectProvider(providers)!.id).toBe('c');
  });

  it('returns null when nothing is usable', () => {
    expect(selectProvider([{ id: 'x', name: 'X', kind: 'openai-compatible', model: 'm' }])).toBeNull();
  });
});

describe('ai providers — maskApiKey', () => {
  it('masks all but the last four characters', () => {
    expect(maskApiKey('abcdef1234')).toBe('••••1234');
  });

  it('returns empty for a missing key', () => {
    expect(maskApiKey(null)).toBe('');
  });
});

describe('ai providers — mergeProviderSecrets', () => {
  it('keeps the stored key when the incoming key is empty', () => {
    const existing: AiProvider[] = [
      { id: 'c', name: 'C', kind: 'openai-compatible', model: 'm', apiKey: 'stored-secret' },
    ];
    const incoming: AiProvider[] = [
      { id: 'c', name: 'C', kind: 'openai-compatible', model: 'm', apiKey: null },
    ];
    const merged = mergeProviderSecrets(incoming, existing);
    expect(merged[0]!.apiKey).toBe('stored-secret');
  });

  it('replaces the key when a new one is supplied', () => {
    const existing: AiProvider[] = [
      { id: 'c', name: 'C', kind: 'openai-compatible', model: 'm', apiKey: 'old' },
    ];
    const incoming: AiProvider[] = [
      { id: 'c', name: 'C', kind: 'openai-compatible', model: 'm', apiKey: 'new' },
    ];
    expect(mergeProviderSecrets(incoming, existing)[0]!.apiKey).toBe('new');
  });
});

describe('ai providers — defaultBaseUrl', () => {
  it('returns provider-specific defaults', () => {
    expect(defaultBaseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(defaultBaseUrl('ollama')).toBe('http://localhost:11434');
    expect(defaultBaseUrl('openai-compatible')).toBe('');
  });
});
