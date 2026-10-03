import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { bareModelTag } from '../../shared/ai';
import type { JudgeLabel } from '../../shared/judges';
import { DEFAULT_OLLAMA_MODEL, isUsable, loadProviders } from './providers';

/**
 * The judging panel behind the anonymous labels Judge01 and Judge02.
 *
 * Judge01 runs the provider's configured model (gpt-oss by default) and Judge02
 * runs a second, different model through the same endpoint and key (Gemma by
 * default). The mapping lives here, in the Worker, and is never serialised into
 * a response: candidates and teachers only see the labels.
 */
export const DEFAULT_JUDGE_2_MODEL = 'gemma4:31b';

export interface Judge {
  label: JudgeLabel;
  providerId: string;
  /** Model override sent with the request; undefined = the provider's own model. */
  model?: string;
}

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI marking is not switched on yet. Your work is saved and a teacher can still mark it.';

/**
 * Who sits on the panel right now. With an Ollama endpoint there are two judges
 * on two different models; with any other provider there is a single judge, and
 * the combined band is simply that judge's band.
 */
export async function resolveJudges(env: Env): Promise<Judge[]> {
  const usable = (await loadProviders(env)).filter((provider) => isUsable(provider));
  if (usable.length === 0) throw new ApiError('AI_UNAVAILABLE', AI_NOT_CONFIGURED_MESSAGE);

  const ollama = usable.filter((provider) => provider.kind === 'OLLAMA');
  if (ollama.length > 0) {
    const lead = ollama.find((provider) => provider.isDefault) ?? ollama[0]!;
    const first = lead.model.trim() || DEFAULT_OLLAMA_MODEL;
    const second = (env.OLLAMA_MODEL_2 ?? '').trim() || DEFAULT_JUDGE_2_MODEL;
    const judges: Judge[] = [{ label: 'Judge01', providerId: lead.id, model: first }];
    // The same model twice would not be a second opinion.
    if (bareModelTag(second).toLowerCase() !== bareModelTag(first).toLowerCase()) {
      judges.push({ label: 'Judge02', providerId: lead.id, model: second });
    }
    return judges;
  }

  const lead = usable.find((provider) => provider.isDefault) ?? usable[0]!;
  return [{ label: 'Judge01', providerId: lead.id }];
}

const RETRYABLE_TEXT = /status 5\d\d|timed out|could not be reached|empty response|did not return valid JSON/i;

/**
 * One judge call with a short, bounded retry: a busy provider (429) or a
 * transient 5xx/empty reply is retried, anything permanent (a rejected key, a
 * missing model) is not.
 */
export async function withJudgeRetry<T>(run: () => Promise<T>, options: { retries?: number; delayMs?: number } = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const delay = options.delayMs ?? 1_500;
  let attempt = 0;
  for (;;) {
    try {
      return await run();
    } catch (error) {
      const retryable =
        error instanceof ApiError &&
        (error.code === 'RATE_LIMITED' || (error.code === 'AI_UNAVAILABLE' && RETRYABLE_TEXT.test(error.message)));
      if (!retryable || attempt >= retries) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
}
