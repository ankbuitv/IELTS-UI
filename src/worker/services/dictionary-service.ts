import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { nowIso } from '../lib/ids';
import { completeJson } from '../ai/providers';
import { describeAiFailure } from '../ai/failure';
import { AI_NOT_CONFIGURED_MESSAGE } from '../ai/judges';
import { DICTIONARY_WORD_PATTERN, buildDictionaryMessages } from '../ai/coach-prompts';
import { findBankWord } from '../../shared/learn-content';
import type { DictionaryEntry, DictionaryMeaning } from '../../shared/learn';

/**
 * Dictionary look-up.
 *
 * The chain is ordered by cost: the built-in word bank answers instantly, then
 * the shared cache, then the AI (which is the only source that also gives a
 * Vietnamese meaning for any word), then a public online dictionary as a last
 * resort when the AI is unavailable. Whatever answers is cached, because a word
 * means the same thing for everybody. The AI is never named in the result.
 */
const CEFR_FOR_LEVEL = { 4: 'B1', 5: 'B1', 6: 'B2', 7: 'C1' } as const;

export function normaliseLookupTerm(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isLookupTerm(term: string): boolean {
  return DICTIONARY_WORD_PATTERN.test(term);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Validates an entry of unknown origin (AI output, cache row, online API) into the public shape. */
export function normaliseDictionaryEntry(
  raw: unknown,
  fallbackTerm: string,
  source: DictionaryEntry['source'],
): DictionaryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const rawMeanings = Array.isArray(value.meanings) ? value.meanings : [];
  const meanings: DictionaryMeaning[] = [];
  for (const item of rawMeanings.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue;
    const meaning = item as Record<string, unknown>;
    const definitions = (Array.isArray(meaning.definitions) ? meaning.definitions : [])
      .slice(0, 3)
      .map((entry) => {
        const d = (entry ?? {}) as Record<string, unknown>;
        return { en: text(d.en, 300), vi: text(d.vi, 300), example: text(d.example, 300) };
      })
      .filter((definition) => definition.en || definition.vi);
    if (definitions.length === 0) continue;
    const synonyms = (Array.isArray(meaning.synonyms) ? meaning.synonyms : [])
      .map((synonym) => text(synonym, 40))
      .filter(Boolean)
      .slice(0, 5);
    meanings.push({ pos: text(meaning.pos, 24), definitions, synonyms });
  }
  if (meanings.length === 0) return null;
  const term = text(value.word, 80) || fallbackTerm;
  const level = text(value.level, 4).toUpperCase();
  return {
    term,
    phonetic: text(value.phonetic, 80),
    level: /^(A1|A2|B1|B2|C1|C2)$/.test(level) ? level : '',
    meanings,
    source,
  };
}

function fromBank(term: string): DictionaryEntry | null {
  const word = findBankWord(term);
  if (!word) return null;
  return {
    term: word.term,
    phonetic: '',
    level: CEFR_FOR_LEVEL[word.level],
    meanings: [
      {
        pos: word.pos,
        definitions: [{ en: word.meaning, vi: word.vi, example: word.example }],
        synonyms: [],
      },
    ],
    source: 'WORDBANK',
  };
}

async function readCache(env: Env, term: string): Promise<DictionaryEntry | null> {
  const row = await env.DB.prepare('SELECT payload_json FROM dictionary_cache WHERE term = ?')
    .bind(term)
    .first<{ payload_json: string }>()
    .catch(() => null);
  if (!row) return null;
  try {
    return normaliseDictionaryEntry(JSON.parse(row.payload_json), term, 'CACHE');
  } catch {
    return null;
  }
}

async function writeCache(env: Env, term: string, entry: DictionaryEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO dictionary_cache (term, payload_json, source, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (term) DO UPDATE SET payload_json = excluded.payload_json, source = excluded.source, fetched_at = excluded.fetched_at`,
  )
    .bind(term, JSON.stringify(entry), entry.source, nowIso())
    .run()
    .catch((error) => console.warn('dictionary_cache_write_failed', String(error)));
}

async function askAi(env: Env, term: string): Promise<DictionaryEntry | null> {
  const { data } = await completeJson<Record<string, unknown>>(env, {
    messages: buildDictionaryMessages(term),
    temperature: 0.2,
    maxTokens: 1_100,
    timeoutMs: 25_000,
    reasoningEffort: 'low',
  });
  return normaliseDictionaryEntry(data, term, 'AI');
}

interface OnlineMeaning {
  partOfSpeech?: string;
  definitions?: Array<{ definition?: string; example?: string }>;
  synonyms?: string[];
}

async function askOnline(term: string): Promise<DictionaryEntry | null> {
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`, {
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Array<{ word?: string; phonetic?: string; meanings?: OnlineMeaning[] }>;
    const first = body[0];
    if (!first) return null;
    return normaliseDictionaryEntry(
      {
        word: first.word ?? term,
        phonetic: first.phonetic ?? '',
        meanings: (first.meanings ?? []).map((meaning) => ({
          pos: meaning.partOfSpeech ?? '',
          definitions: (meaning.definitions ?? []).slice(0, 2).map((d) => ({ en: d.definition ?? '', vi: '', example: d.example ?? '' })),
          synonyms: meaning.synonyms ?? [],
        })),
      },
      term,
      'ONLINE',
    );
  } catch {
    return null;
  }
}

async function isSaved(env: Env, userId: string, term: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS one FROM vocabulary_entries WHERE user_id = ? AND term = ? COLLATE NOCASE')
    .bind(userId, term)
    .first<{ one: number }>()
    .catch(() => null);
  return Boolean(row);
}

export interface LookupOutcome {
  entry: DictionaryEntry | null;
  /** Set when the word was not found and the AI could not be asked. */
  unavailable?: string;
}

export async function lookupWord(env: Env, userId: string, rawTerm: string): Promise<LookupOutcome> {
  const term = normaliseLookupTerm(rawTerm);
  if (!isLookupTerm(term)) {
    throw ApiError.validation('Type one English word or short phrase (letters, spaces and hyphens only).');
  }

  let entry = fromBank(term) ?? (await readCache(env, term));
  let unavailable: string | undefined;

  if (!entry) {
    try {
      entry = await askAi(env, term);
      if (entry) await writeCache(env, term, entry);
    } catch (error) {
      const failure = describeAiFailure(error, { task: 'dictionary' });
      unavailable =
        failure.message === AI_NOT_CONFIGURED_MESSAGE
          ? 'Only the built-in word list is available right now, and this word is not in it.'
          : 'The dictionary could not look that word up right now. Please try again in a moment.';
    }
  }
  if (!entry) {
    entry = await askOnline(term);
    if (entry) {
      await writeCache(env, term, entry);
      unavailable = undefined;
    }
  }
  if (!entry) return { entry: null, ...(unavailable ? { unavailable } : {}) };
  return { entry: { ...entry, saved: await isSaved(env, userId, entry.term) } };
}
