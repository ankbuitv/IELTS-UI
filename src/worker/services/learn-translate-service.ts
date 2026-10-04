/**
 * Vietnamese for an English sentence, on demand.
 *
 * The answer panel shows the sentence the learner has just met — the example,
 * the passage line, the model answer — and a Vietnamese rendering of it, which
 * is the difference between recognising the answer and understanding the
 * sentence.
 *
 * Two things shape the design:
 *
 *   * The lesson content is shared, so the same sentences come round again for
 *     every learner. The cache (`learn_translations`, keyed by the SHA-256 of
 *     the normalised sentence) means the provider is paid once per sentence in
 *     the whole platform, not once per reader or per replay.
 *   * Translation is a nice-to-have on a page that has already given its
 *     answer, so a missing provider must not read as an error: the caller gets
 *     `available: false` and the client falls back to the word's own gloss
 *     instead of an empty box or a scary message.
 */
import type { Env } from '../env';
import { nowIso } from '../lib/ids';
import { sha256Hex } from '../lib/crypto';
import { completeJson } from '../ai/providers';
import { describeAiFailure } from '../ai/failure';
import { buildTranslationMessages } from '../ai/coach-prompts';
import type { TranslationResult } from '../../shared/learn';

/** Sentences longer than this are truncated rather than refused: a long passage line still translates. */
const MAX_SENTENCE = 400;

function clean(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, MAX_SENTENCE);
}

export async function translateSentence(env: Env, raw: string): Promise<TranslationResult> {
  const text = clean(raw);
  if (text.length < 2) return { vi: '', source: 'NONE', available: false };

  const hash = await sha256Hex(text.toLowerCase());
  const hit = await env.DB.prepare('SELECT vi FROM learn_translations WHERE hash = ?')
    .bind(hash)
    .first<{ vi: string }>()
    .catch(() => null);
  if (hit?.vi) return { vi: hit.vi, source: 'CACHE', available: true };

  try {
    const { data } = await completeJson<{ vi?: unknown }>(env, {
      messages: buildTranslationMessages(text),
      temperature: 0.2,
      maxTokens: 600,
      timeoutMs: 20_000,
      reasoningEffort: 'low',
    });
    const vi = typeof data.vi === 'string' ? clean(data.vi) : '';
    if (!vi) return { vi: '', source: 'NONE', available: false };
    await env.DB.prepare(
      'INSERT OR REPLACE INTO learn_translations (hash, text, vi, source, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(hash, text, vi, 'AI', nowIso())
      .run()
      .catch((error) => console.warn('translation_cache_write_failed', String(error)));
    return { vi, source: 'AI', available: true };
  } catch (error) {
    // Logged like every other AI failure, but not thrown: the answer panel is
    // already on screen and does not depend on this.
    describeAiFailure(error, { task: 'translate' });
    return { vi: '', source: 'NONE', available: false };
  }
}
