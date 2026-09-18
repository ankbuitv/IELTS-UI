import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { QUESTION_TYPES } from '../../shared/question-types';

/**
 * Server-side OpenAI integration used by the AI-assisted import pipeline.
 *
 * Guarantees:
 *  - the API key never leaves the Worker; it is never returned by any endpoint,
 *  - every response is validated against a strict JSON Schema and then re-validated
 *    with Zod before it can reach an admin draft,
 *  - the model is never asked to invent an answer key: when the source material
 *    does not contain answers the structured output must mark them absent.
 */

export interface AiStatus {
  available: boolean;
  model?: string;
  reason?: string;
}

export function aiStatus(env: Env): AiStatus {
  if (!env.OPENAI_API_KEY) {
    return {
      available: false,
      reason:
        'AI import is unavailable: no OpenAI API key is configured for this Worker. Manual authoring and manual import remain available.',
    };
  }
  return { available: true, model: env.OPENAI_MODEL || 'gpt-4.1' };
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
  const status = aiStatus(env);
  if (!status.available) throw new ApiError('AI_UNAVAILABLE', status.reason ?? 'AI import is unavailable.');

  const model = env.OPENAI_MODEL || 'gpt-4.1';
  const sourceText = (request.sourceText ?? '').slice(0, 120_000);

  if (!sourceText.trim() && (!request.imageDataUrls || request.imageDataUrls.length === 0) && !request.audioTranscript) {
    throw new ApiError('VALIDATION_FAILED', 'There is no extracted text or image to structure.');
  }

  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'input_text',
      text: [
        `File name: ${request.filename}`,
        request.titleHint ? `Title hint: ${request.titleHint}` : null,
        request.audioTranscript ? `Audio transcript:\n${request.audioTranscript.slice(0, 60_000)}` : null,
        sourceText ? `Source text:\n\n${sourceText}` : null,
        'Return the structured test as JSON.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  for (const dataUrl of request.imageDataUrls ?? []) {
    userContent.push({ type: 'input_image', image_url: dataUrl });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: userContent },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: STRUCTURED_TEST_SCHEMA_NAME,
          strict: true,
          schema: STRUCTURED_TEST_JSON_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('openai_error', response.status, detail.slice(0, 500));
    if (response.status === 429) {
      throw new ApiError('RATE_LIMITED', 'The AI provider is rate limiting requests. Try again shortly.');
    }
    throw new ApiError('AI_UNAVAILABLE', `The AI provider rejected the request (status ${response.status}).`);
  }

  const body = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text =
    body.output_text ??
    (body.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' || typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('');

  if (!text) throw new ApiError('AI_UNAVAILABLE', 'The AI provider returned an empty response.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError('AI_UNAVAILABLE', 'The AI response was not valid JSON. Nothing was saved.');
  }

  const usage = body.usage
    ? { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens }
    : undefined;

  return { payload: parsed, model, ...(usage ? { usage } : {}) };
}

/** Optional transcription for Listening audio imports. */
export async function transcribeAudio(env: Env, file: File): Promise<string> {
  const status = aiStatus(env);
  if (!status.available) throw new ApiError('AI_UNAVAILABLE', 'AI import is unavailable.');

  const form = new FormData();
  form.append('file', file);
  form.append('model', env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe');
  form.append('response_format', 'json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('openai_transcribe_error', response.status, detail.slice(0, 300));
    throw new ApiError('AI_UNAVAILABLE', 'Transcription failed.');
  }

  const body = (await response.json()) as { text?: string };
  return body.text ?? '';
}
