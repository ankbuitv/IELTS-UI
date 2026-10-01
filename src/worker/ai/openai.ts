import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { QUESTION_TYPES } from '../../shared/question-types';
import {
  aiStatusFromProviders,
  isProviderUsable,
  resolveAiProviders,
  selectProvider,
  toMaskedProvider,
  type AiProvider,
  type AiStatus,
} from './providers';

/**
 * Server-side AI integration used by the AI-assisted import pipeline and the
 * AI grading assistant.
 *
 * Guarantees:
 *  - API keys never leave the Worker and are never returned by any endpoint,
 *  - every structured response is validated against a strict JSON Schema before
 *    it can reach an admin draft,
 *  - the model is never asked to invent an answer key: when the source material
 *    does not contain answers the structured output must mark them absent.
 *
 * Works with any registered provider (OpenAI, OpenAI-compatible endpoints such
 * as Chutes/Groq/OpenRouter, and local Ollama).
 */

export type AiStatusResult = AiStatus;

export function aiStatus(env: Env): Promise<AiStatus> {
  return resolveAiProviders(env).then(aiStatusFromProviders);
}

export const STRUCTURED_TEST_SCHEMA_NAME = 'ielts_style_test_structure';

/** Strict JSON Schema (additionalProperties:false everywhere, all fields required). */
export const STRUCTURED_TEST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['testTitle', 'testType', 'answerKeyConfidence', 'passages', 'sections', 'warnings'],
  properties: {
    testTitle: { type: ['string', 'null'] },
    testType: { type: 'string', enum: ['READING', 'LISTENING', 'WRITING', 'FULL_MOCK'] },
    answerKeyConfidence: { type: 'string', enum: ['PROVIDED', 'PARTIAL', 'ABSENT'] },
    warnings: { type: 'array', items: { type: 'string' } },
    passages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'paragraphs'],
        properties: {
          title: { type: ['string', 'null'] },
          paragraphs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'text'],
              properties: {
                label: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
    },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['skill', 'title', 'instructions', 'passageIndex', 'audioProvided', 'groups'],
        properties: {
          skill: { type: 'string', enum: ['READING', 'LISTENING', 'WRITING'] },
          title: { type: ['string', 'null'] },
          instructions: { type: ['string', 'null'] },
          passageIndex: { type: ['integer', 'null'] },
          audioProvided: { type: 'boolean' },
          groups: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['questionType', 'instructions', 'optionNumbering', 'sharedOptions', 'selectCount', 'wordLimitMax', 'questions'],
              properties: {
                questionType: { type: 'string', enum: [...QUESTION_TYPES] },
                instructions: { type: ['string', 'null'] },
                optionNumbering: { type: ['string', 'null'], enum: ['roman', 'alpha', 'numeric', null] },
                sharedOptions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'text'],
                    properties: { id: { type: 'string' }, text: { type: 'string' } },
                  },
                },
                selectCount: { type: ['integer', 'null'] },
                wordLimitMax: { type: ['integer', 'null'] },
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['number', 'prompt', 'options', 'answer', 'evidence', 'explanation'],
                    properties: {
                      number: { type: 'integer' },
                      prompt: { type: 'string' },
                      options: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['id', 'text'],
                          properties: { id: { type: 'string' }, text: { type: 'string' } },
                        },
                      },
                      answer: { type: ['string', 'null'] },
                      evidence: { type: ['string', 'null'] },
                      explanation: { type: ['string', 'null'] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You structure original or licensed English-language test material into a machine-readable practice test.

Rules you must follow:
1. Transcribe content faithfully. Never invent passages, questions, options or facts that are not present in the source.
2. Never fabricate an answer key. If the source does not state the answers, set each question's "answer" to null and set answerKeyConfidence to "ABSENT" (or "PARTIAL" when only some answers appear).
3. Only record an answer when the source material contains it. Keep the source's own wording in "evidence".
4. Preserve question numbering exactly as printed.
5. Choose the question type that matches the task's printed instructions from the allowed list.
6. For matching tasks, put the option bank in "sharedOptions" and answer with the option id.
7. For TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN tasks, answers must be TRUE, FALSE, NOT_GIVEN, YES, NO or NOT_GIVEN.
8. For multiple-answer tasks (MCQ_MULTI) set selectCount and list every correct option id in "answer" separated by "|".
9. Extract word limits from instructions into wordLimitMax when stated.
10. Use "warnings" for anything unclear, ambiguous or partially missing.
11. Do not include any copyrighted branding or claims of official affiliation.`;

export interface AiStructureRequest {
  sourceText?: string;
  filename: string;
  titleHint?: string;
  imageDataUrls?: string[];
  audioTranscript?: string;
  /** Optional provider selection; falls back to the default provider. */
  providerId?: string | null;
}

export interface AiStructureResponse {
  payload: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Calls a provider's chat/structured endpoint and returns the model text plus
 * usage. Ollama uses its native /api/chat with a JSON `format`; every other
 * provider uses the OpenAI-compatible /chat/completions with a json_schema
 * response_format.
 */
async function callStructured(
  provider: AiProvider,
  system: string,
  user: string,
  schemaName: string,
  schema: unknown,
): Promise<{ text: string; model: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const model = provider.model;

  if (provider.kind === 'ollama') {
    const base = (provider.baseUrl || 'http://localhost:11434').replace(/\/v1\/?$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: false,
        format: schema,
        options: { temperature: 0 },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('ollama_error', response.status, detail.slice(0, 500));
      if (response.status === 429) throw new ApiError('RATE_LIMITED', 'The AI provider is rate limiting requests. Try again shortly.');
      throw new ApiError('AI_UNAVAILABLE', `The AI provider rejected the request (status ${response.status}).`);
    }
    const body = (await response.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    const text = body.message?.content ?? '';
    if (!text) throw new ApiError('AI_UNAVAILABLE', 'The AI provider returned an empty response.');
    return {
      text,
      model,
      usage:
        body.prompt_eval_count != null || body.eval_count != null
          ? { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count }
          : undefined,
    };
  }

  const base = provider.baseUrl || 'https://api.openai.com/v1';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('ai_error', response.status, detail.slice(0, 500));
    if (response.status === 429) {
      throw new ApiError('RATE_LIMITED', 'The AI provider is rate limiting requests. Try again shortly.');
    }
    throw new ApiError('AI_UNAVAILABLE', `The AI provider rejected the request (status ${response.status}).`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text =
    body.choices?.[0]?.message?.content ??
    (() => {
      throw new ApiError('AI_UNAVAILABLE', 'The AI provider returned an empty response.');
    })();

  const usage = body.usage
    ? { inputTokens: body.usage.prompt_tokens, outputTokens: body.usage.completion_tokens }
    : undefined;

  return { text, model, usage };
}

export async function structureTestFromSource(
  env: Env,
  request: AiStructureRequest,
): Promise<AiStructureResponse> {
  const providers = await resolveAiProviders(env);
  const provider = selectProvider(providers, request.providerId);
  if (!provider || !isProviderUsable(provider)) {
    const status = aiStatusFromProviders(providers);
    throw new ApiError('AI_UNAVAILABLE', status.reason ?? 'AI import is unavailable.');
  }

  const sourceText = (request.sourceText ?? '').slice(0, 120_000);
  if (!sourceText.trim() && (!request.imageDataUrls || request.imageDataUrls.length === 0) && !request.audioTranscript) {
    throw new ApiError('VALIDATION_FAILED', 'There is no extracted text or image to structure.');
  }

  const userContent = [
    `File name: ${request.filename}`,
    request.titleHint ? `Title hint: ${request.titleHint}` : null,
    request.audioTranscript ? `Audio transcript:\n${request.audioTranscript.slice(0, 60_000)}` : null,
    sourceText ? `Source text:\n\n${sourceText}` : null,
    'Return the structured test as JSON.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const { text, model, usage } = await callStructured(
    provider,
    SYSTEM_PROMPT,
    userContent,
    STRUCTURED_TEST_SCHEMA_NAME,
    STRUCTURED_TEST_JSON_SCHEMA,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError('AI_UNAVAILABLE', 'The AI response was not valid JSON. Nothing was saved.');
  }

  return { payload: parsed, model, ...(usage ? { usage } : {}) };
}

// -----------------------------------------------------------------------------
// AI grading assistant
// -----------------------------------------------------------------------------

export const GRADING_RESULT_SCHEMA_NAME = 'ielts_answer_grade';

const GRADING_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['correct', 'score', 'confidence', 'feedback', 'reasoning'],
  properties: {
    correct: { type: 'boolean' },
    score: { type: 'number' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    feedback: { type: 'string' },
    reasoning: { type: 'string' },
  },
} as const;

const GRADING_SYSTEM_PROMPT = `You are an experienced IELTS examiner grading a single candidate answer.

You are given:
- the question type and the exact question prompt,
- the relevant passage/transcript text (if available),
- the official answer or accepted answer(s),
- the candidate's answer.

Grade strictly against the official answer and the passage evidence. For
objective item types (multiple choice, true/false/not given, matching, yes/no/not
given) the answer is right or wrong. For short-answer, sentence/summary/note/table
completion and similar text answers, accept any answer that matches the required
information and obeys the stated word limit; minor spelling of proper nouns and
acceptable synonyms are fine. Never invent credit the candidate did not earn.

Return:
- correct: true when the candidate answer earns full or partial credit, false when it is wrong,
- score: a number from 0 (fully wrong) to 1 (fully correct); use 0.5 for a partially correct answer,
- confidence: high when the judgement is unambiguous, medium when reasonable, low when the source is unclear,
- feedback: one or two sentences the candidate would find useful,
- reasoning: a short examiner note citing the evidence.`;

export interface AiGradeRequest {
  questionType?: string;
  questionPrompt: string;
  passageText?: string | null;
  officialAnswer?: string | null;
  candidateAnswer: string;
  options?: Array<{ id: string; text: string }>;
  /** Optional provider selection; falls back to the default provider. */
  providerId?: string | null;
}

export interface AiGradeResult {
  correct: boolean;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  feedback: string;
  reasoning: string;
  model: string;
  providerId: string;
}

export async function gradeWithAi(env: Env, request: AiGradeRequest): Promise<AiGradeResult> {
  const providers = await resolveAiProviders(env);
  const provider = selectProvider(providers, request.providerId);
  if (!provider || !isProviderUsable(provider)) {
    const status = aiStatusFromProviders(providers);
    throw new ApiError('AI_UNAVAILABLE', status.reason ?? 'AI grading is unavailable: no provider is configured.');
  }

  const optionsBlock = request.options && request.options.length > 0
    ? `\n\nOptions:\n${request.options.map((option) => `- ${option.id}: ${option.text}`).join('\n')}`
    : '';
  const passageBlock = request.passageText?.trim()
    ? `\n\nPassage / transcript:\n${request.passageText.trim().slice(0, 30_000)}`
    : '';
  const officialBlock = request.officialAnswer?.trim()
    ? `\n\nOfficial answer / accepted answers:\n${request.officialAnswer.trim()}`
    : '\n\nOfficial answer: not supplied — judge against the passage evidence only.';

  const user = [
    `Question type: ${request.questionType ?? 'UNKNOWN'}`,
    `Question: ${request.questionPrompt.trim()}`,
    passageBlock,
    officialBlock,
    optionsBlock,
    `\n\nCandidate answer:\n${request.candidateAnswer.trim() || '(no answer provided)'}`,
    '\n\nGrade this answer and return the result as JSON.',
  ].join('\n');

  const { text, model } = await callStructured(
    provider,
    GRADING_SYSTEM_PROMPT,
    user,
    GRADING_RESULT_SCHEMA_NAME,
    GRADING_RESULT_SCHEMA,
  );

  let parsed: {
    correct?: unknown;
    score?: unknown;
    confidence?: unknown;
    feedback?: unknown;
    reasoning?: unknown;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new ApiError('AI_UNAVAILABLE', 'The AI grading response was not valid JSON.');
  }

  const correct = Boolean(parsed.correct);
  const score = typeof parsed.score === 'number' && Number.isFinite(parsed.score)
    ? Math.min(1, Math.max(0, parsed.score))
    : correct
      ? 1
      : 0;
  const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
    ? parsed.confidence
    : 'medium';

  return {
    correct,
    score,
    confidence,
    feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    model,
    providerId: provider.id,
  };
}

/** Optional transcription for Listening audio imports (OpenAI only). */
export async function transcribeAudio(env: Env, file: File): Promise<string> {
  const providers = await resolveAiProviders(env);
  const openaiLike = providers.find(
    (provider) => (provider.kind === 'openai' || provider.kind === 'openai-compatible') && isProviderUsable(provider),
  );
  const apiKey = openaiLike?.apiKey || env.OPENAI_API_KEY;
  if (!apiKey) throw new ApiError('AI_UNAVAILABLE', 'AI import is unavailable (no transcription-capable key).');

  const base = openaiLike && openaiLike.kind === 'openai' ? openaiLike.baseUrl || 'https://api.openai.com/v1' : 'https://api.openai.com/v1';
  const model = env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';

  const form = new FormData();
  form.append('file', file);
  form.append('model', model);
  form.append('response_format', 'json');

  const response = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('transcribe_error', response.status, detail.slice(0, 300));
    throw new ApiError('AI_UNAVAILABLE', 'Transcription failed.');
  }

  const body = (await response.json()) as { text?: string };
  return body.text ?? '';
}

export { toMaskedProvider };
