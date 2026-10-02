import { ApiError } from '../lib/errors';
import { isCheckConstraintError } from '../lib/ensure-schema';
import { AI_NOT_CONFIGURED_MESSAGE } from './judges';

export interface AiFailure {
  code: string;
  message: string;
}

/**
 * Anything that could name a vendor, a model, an endpoint or a key. Candidates
 * and teachers must never learn which models sit behind Judge01 and Judge02, so
 * a message is scrubbed even when it is one of ours.
 */
const IDENTIFYING =
  /https?:\/\/\S+|\b(?:gpt[-\w.:]*|gemma[-\w.:]*|ollama[-\w.:]*|openai[-\w.:]*|deepseek[-\w.:]*|llama[-\w.:]*|qwen[-\w.:]*|mistral[-\w.:]*|claude[-\w.:]*|gemini[-\w.:]*)\b/gi;

export function scrubIdentifyingText(text: string): string {
  return text.replace(IDENTIFYING, 'the judge').replace(/(?:the judge[\s,]*){2,}/gi, 'the judge ');
}

const BUSY_MESSAGE = 'The judges are busy right now. Your work is saved — please try again in a minute.';
const GENERIC_MESSAGE = 'The judges could not finish marking this time. Your work is saved — please try again.';

/**
 * Turns whatever an AI-marking call threw into a message a candidate can act on,
 * and writes the real error to the Worker log.
 *
 * Provider detail (labels, URLs, model names, upstream bodies) goes to the log
 * only. What is returned is deliberately generic about the provider and
 * specific about what the candidate can do next.
 */
export function describeAiFailure(error: unknown, context: Record<string, unknown> = {}): AiFailure {
  if (error instanceof ApiError) {
    if (error.status >= 500) console.error('ai_marking_failed', JSON.stringify(context), error.code, error.message);
    if (error.code === 'RATE_LIMITED') return { code: error.code, message: BUSY_MESSAGE };
    if (error.code === 'AI_UNAVAILABLE') {
      if (error.message === AI_NOT_CONFIGURED_MESSAGE) return { code: error.code, message: error.message };
      if (/no AI provider|rejected the API key|disabled or missing/i.test(error.message)) {
        return { code: error.code, message: AI_NOT_CONFIGURED_MESSAGE };
      }
      if (/timed out|could not be reached|rate limit/i.test(error.message)) return { code: error.code, message: BUSY_MESSAGE };
      if (/database|table|stored the score|schema/i.test(error.message)) {
        return { code: error.code, message: scrubIdentifyingText(error.message) };
      }
      return { code: error.code, message: GENERIC_MESSAGE };
    }
    return { code: error.code, message: scrubIdentifyingText(error.message) };
  }

  console.error('ai_marking_failed', JSON.stringify(context), error);
  const text = error instanceof Error ? error.message : String(error);

  if (isCheckConstraintError(error)) {
    return {
      code: 'AI_STORAGE',
      message:
        'The judges answered, but the database could not store the score (an old table definition is still in place). It repairs itself on the next request, so please try again. If it keeps failing, an administrator can run the schema repair in Admin → System health.',
    };
  }
  if (/no such (table|column)/i.test(text)) {
    return {
      code: 'AI_STORAGE',
      message:
        'The database is missing a table that AI marking needs. An administrator should apply the latest migrations (Admin → System health).',
    };
  }
  if (error instanceof SyntaxError) return { code: 'AI_UNAVAILABLE', message: GENERIC_MESSAGE };
  return {
    code: 'AI_UNAVAILABLE',
    message: `The AI marking failed unexpectedly${error instanceof Error ? ` (${error.name})` : ''}. Please try again; if it keeps happening, tell an administrator.`,
  };
}
