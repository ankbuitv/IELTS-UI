import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { QUESTION_TYPES } from '../../shared/question-types';
import type { AiStatus } from '../../shared/ai';
import { completeJson, providerStatus, transcribeWithProvider, type ChatContentPart } from './providers';

/**
 * AI-assisted import structuring.
 *
 * This module is provider-agnostic: it resolves whichever provider an
 * administrator configured in Admin -> Settings -> AI providers (Ollama cloud
 * with `gpt-oss:120b` / `gemma3:27b`, OpenAI, or any OpenAI-compatible
 * gateway). See `./providers.ts` for transport and key handling.
 *
 * Guarantees:
 *  - the API key never leaves the Worker; it is never returned by any endpoint,
 *  - every response is validated against a strict JSON Schema and then re-validated
 *    with Zod before it can reach an admin draft,
 *  - the model is never asked to invent an answer key: when the source material
 *    does not contain answers the structured output must mark them absent.
 */

/** Reports the AI provider status. Keys are never included. */
export async function aiStatus(env: Env): Promise<AiStatus> {
  return providerStatus(env);
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
}

export interface AiStructureResponse {
  payload: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export async function structureTestFromSource(
  env: Env,
  request: AiStructureRequest,
): Promise<AiStructureResponse> {
  const status = await aiStatus(env);
  if (!status.available) throw new ApiError('AI_UNAVAILABLE', status.reason ?? 'AI import is unavailable.');

  const sourceText = (request.sourceText ?? '').slice(0, 120_000);

  if (!sourceText.trim() && (!request.imageDataUrls || request.imageDataUrls.length === 0) && !request.audioTranscript) {
    throw new ApiError('VALIDATION_FAILED', 'There is no extracted text or image to structure.');
  }

  const promptText = [
    `File name: ${request.filename}`,
    request.titleHint ? `Title hint: ${request.titleHint}` : null,
    request.audioTranscript ? `Audio transcript:\n${request.audioTranscript.slice(0, 60_000)}` : null,
    sourceText ? `Source text:\n\n${sourceText}` : null,
    request.imageDataUrls?.length
      ? `${request.imageDataUrls.length} page image(s) were supplied; work only from the text that accompanies them.`
      : null,
    'Return the structured test as JSON.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const userContent: ChatContentPart[] = [{ type: 'text', text: promptText }];
  for (const dataUrl of request.imageDataUrls ?? []) {
    userContent.push({ type: 'image_url', image_url: { url: dataUrl } });
  }

  const result = await completeJson<unknown>(env, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: request.imageDataUrls?.length ? userContent : promptText },
    ],
    temperature: 0.1,
    jsonSchema: { name: STRUCTURED_TEST_SCHEMA_NAME, schema: STRUCTURED_TEST_JSON_SCHEMA as unknown as Record<string, unknown> },
    timeoutMs: 180_000,
  });

  return {
    payload: result.data,
    model: result.provider.model,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/** Optional transcription for Listening audio imports, via the configured provider. */
export async function transcribeAudio(env: Env, file: File): Promise<string> {
  const status = await aiStatus(env);
  if (!status.available) throw new ApiError('AI_UNAVAILABLE', 'AI import is unavailable.');
  return transcribeWithProvider(env, file);
}
