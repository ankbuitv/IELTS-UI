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
11. Do not include any copyrighted branding or claims of official affiliation.
12. When page images are supplied as scans, read them with OCR: transcribe the printed text verbatim before structuring it, and mention unreadable fragments in "warnings".`;

export interface AiStructureRequest {
  sourceText?: string;
  filename: string;
  titleHint?: string;
  imageDataUrls?: string[];
  audioTranscript?: string;
  /** True when the images are scans with no text layer: the model must OCR them. */
  ocr?: boolean;
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
      ? request.ocr
        ? `${request.imageDataUrls.length} scanned page image(s) are attached. Transcribe every visible word — headings, instructions, passages, questions, options, tables and any printed answer key — then structure the test. Do not summarise or skip instructions.`
        : `${request.imageDataUrls.length} page image(s) were supplied; work only from the text that accompanies them.`
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

const GENERATION_SYSTEM_PROMPT = `You write ORIGINAL IELTS-style Reading practice tests for a study platform.

Non-negotiable rules:
1. Invent every passage. Never reproduce, paraphrase or closely follow a real IELTS, Cambridge, British Council or IDP passage. Do not mention those organisations in the passage.
2. Never copy a real question. The topic prompt from the administrator is a brief, not a text to copy.
3. Each section has its own passage of roughly 650–900 words in 4–6 paragraphs labelled A, B, C…
4. Every question must be answerable from the passage. Include the exact supporting sentence in "evidence" and a one-sentence "explanation".
5. Number questions consecutively across sections (section 1 starts at 1; section 2 continues).
6. Use only question types from the schema enum. Use sharedOptions for matching tasks and selectCount for multi-answer tasks.
7. testType must be "READING"; answerKeyConfidence must be "PROVIDED"; warnings may be empty.
8. Use consistent British spelling. Keep the register academic but readable.
9. The material is a practice test, not an official exam: no "official", no band claims inside the passage.`;

export function buildGenerationPrompt(input: AiGenerateRequest): string {
  return [
    `Create ${input.sections} Reading section(s) at approximately band ${input.band}.`,
    `Questions per section: ${input.questionsPerSection}.`,
    input.title ? `Working title: ${input.title}` : null,
    `Administrator brief: ${input.prompt}`,
    'Return the whole test as one JSON object matching the schema.',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface AiGenerateRequest {
  prompt: string;
  title?: string;
  band: number;
  sections: number;
  questionsPerSection: number;
}

/** Creates an original Reading test from an admin brief. Always lands in REVIEW. */
export async function generateTestFromPrompt(env: Env, input: AiGenerateRequest): Promise<AiStructureResponse> {
  const status = await aiStatus(env);
  if (!status.available) throw new ApiError('AI_UNAVAILABLE', status.reason ?? 'AI generation is unavailable.');

  const result = await completeJson<unknown>(env, {
    messages: [
      { role: 'system', content: GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: buildGenerationPrompt(input) },
    ],
    temperature: 0.75,
    maxTokens: 14_000,
    timeoutMs: 300_000,
    jsonSchema: { name: STRUCTURED_TEST_SCHEMA_NAME, schema: STRUCTURED_TEST_JSON_SCHEMA as unknown as Record<string, unknown> },
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
