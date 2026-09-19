/**
 * Import payload → editable content conversion, shared by the Worker and the
 * browser (feature 32).
 *
 * `src/worker/services/import-service.ts` uses this module inside the import
 * pipeline; the admin test editor uses the same code in the browser so the
 * version JSON tab can accept the documented import formats
 * (`docs/samples/*.json`) as well as the platform's own content schema.
 *
 * Deterministic only: nothing here calls the network, the database or the AI.
 */
import { z } from 'zod';
import {
  isQuestionType,
  QUESTION_TYPE_META,
  type AudioPlaybackPolicy,
  type CandidateQuestion,
  type PassageParagraph,
  type QuestionGroupConfig,
  type QuestionType,
  type SharedOption,
} from './question-types';
import {
  defaultSectionTypeForSkill,
  normaliseSectionType,
  SECTION_TYPE_META,
  type SectionType,
  type TranscriptSegment,
} from './sections';
import type { AnswerKey } from './answer-key';
import type { Skill } from './types';
import type { ValidationIssue } from './validation';

// -----------------------------------------------------------------------------
// Editable content tree — the wire shape of `PUT /api/admin/versions/:id/content`
// (mirrored by the worker's `content-write-service` and the admin editor).
// -----------------------------------------------------------------------------

export interface EditableQuestion {
  number: number;
  prompt: string;
  options: SharedOption[];
  config: QuestionGroupConfig;
  body?: CandidateQuestion['body'];
  answerKey?: AnswerKey | null;
  evidence?: string | null;
  explanation?: string | null;
}

export interface EditableGroup {
  type: QuestionType;
  instructions: string;
  sharedOptions: SharedOption[];
  config: QuestionGroupConfig;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  questions: EditableQuestion[];
}

export interface EditableSection {
  skill: Skill;
  /** Normalised structural type; derived from the skill when omitted. */
  type?: SectionType | string | null;
  /** Short display label ("Passage 1", "Part 2", "Task 1"). */
  label?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  instructions: string;
  durationSeconds?: number | null;
  passage?: {
    title: string;
    subtitle?: string | null;
    paragraphs: PassageParagraph[];
    /**
     * Word count declared by the source file. Never trusted or stored: the
     * canonical count is recomputed from the paragraph text on write.
     */
    passageWordCount?: number | null;
  } | null;
  audioAssetId?: string | null;
  /** Convenience: a pasted HTTPS audio URL is turned into an asset on save. */
  audioUrl?: string | null;
  playback?: Partial<AudioPlaybackPolicy>;
  /** Segment-based listening transcript (candidate-visible in review). */
  transcript?: { segments: TranscriptSegment[] } | null;
  /** Optional section image: an existing asset id or a pasted HTTPS URL. */
  imageAssetId?: string | null;
  imageUrl?: string | null;
  /** Explicit order hint; the persisted order is the array position. */
  order?: number | null;
  groups: EditableGroup[];
}

export interface EditableMockComponent {
  skill: Skill;
  testVersionId: string;
  label: string;
  durationSeconds: number;
  breakAfterSeconds: number;
}

export interface EditableContent {
  sections: EditableSection[];
  mockComponents?: EditableMockComponent[];
  durationSeconds?: number | null;
  isCompleteTest?: boolean;
  scoringProfileId?: string | null;
  config?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// AI payload → editable content (deterministic, zod-validated)
// -----------------------------------------------------------------------------
const optionSchema = z.object({ id: z.string().min(1), text: z.string() });

const aiPayloadSchema = z.object({
  testTitle: z.string().nullable().optional(),
  testType: z.enum(['READING', 'LISTENING', 'WRITING', 'FULL_MOCK']),
  answerKeyConfidence: z.enum(['PROVIDED', 'PARTIAL', 'ABSENT']),
  warnings: z.array(z.string()).default([]),
  passages: z
    .array(
      z.object({
        title: z.string().nullable().optional(),
        // Informational only. The platform recomputes the count from the text
        // and reports a mismatch instead of trusting this number.
        passageWordCount: z.number().int().nullable().optional(),
        paragraphs: z.array(z.object({ label: z.string(), text: z.string() })),
      }),
    )
    .default([]),
  sections: z.array(
    z.object({
      skill: z.enum(['READING', 'LISTENING', 'WRITING']),
      title: z.string().nullable().optional(),
      instructions: z.string().nullable().optional(),
      passageIndex: z.number().int().nullable().optional(),
      audioProvided: z.boolean().default(false),
      groups: z.array(
        z.object({
          questionType: z.string(),
          instructions: z.string().nullable().optional(),
          optionNumbering: z.enum(['roman', 'alpha', 'numeric']).nullable().optional(),
          sharedOptions: z.array(optionSchema).default([]),
          selectCount: z.number().int().nullable().optional(),
          wordLimitMax: z.number().int().nullable().optional(),
          questions: z.array(
            z.object({
              number: z.number().int(),
              prompt: z.string().default(''),
              options: z.array(optionSchema).default([]),
              answer: z.string().nullable().optional(),
              evidence: z.string().nullable().optional(),
              explanation: z.string().nullable().optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export interface ConvertedAiPayload {
  content: EditableContent;
  issues: ValidationIssue[];
  answerKeyConfidence: 'PROVIDED' | 'PARTIAL' | 'ABSENT';
  questionCount: number;
}

export function convertAiPayload(payload: unknown): ConvertedAiPayload {
  if (looksLikeEditableContent(payload)) {
    return fromEditableContent(payload as EditableContent);
  }
  // 32: section-aware structured JSON (sections with questionGroups, explicit
  // types, labels, passage/audio/transcript blocks). Tries the rich format
  // first; falls back to the flatter source-document mapping.
  if (looksLikeSectionedImport(payload)) {
    return sectionedImportToEditableContent(payload);
  }
  const asAi = looksLikeSourceDocument(payload) ? sourceDocumentToAiPayload(payload) : payload;
  const parsed = aiPayloadSchema.safeParse(asAi);
  if (!parsed.success) {
    const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
      level: 'ERROR' as const,
      code: 'AI_PAYLOAD_SCHEMA',
      message: `${issue.path.join('.')}: ${issue.message}`,
    }));
    return { content: { sections: [] }, issues, answerKeyConfidence: 'ABSENT', questionCount: 0 };
  }

  const data = parsed.data;
  const issues: ValidationIssue[] = [];
  let questionCount = 0;
  let answeredQuestions = 0;
  let totalQuestions = 0;

  for (const warning of data.warnings) {
    issues.push({ level: 'WARNING', code: 'AI_WARNING', message: warning });
  }

  const sections: EditableContent['sections'] = data.sections.map((section, index) => {
    const passage = section.passageIndex !== null && section.passageIndex !== undefined
      ? data.passages[section.passageIndex]
      : undefined;
    if (section.passageIndex !== null && section.passageIndex !== undefined && !passage) {
      issues.push({
        level: 'ERROR',
        code: 'AI_MISSING_PASSAGE_REFERENCE',
        message: `Section ${index + 1} references passage ${section.passageIndex} which was not returned.`,
      });
    }

    const groups: EditableGroup[] = section.groups
      .map((group, groupIndex): EditableGroup | null => {
      const type = group.questionType;
      if (!isQuestionType(type)) {
        // The group is dropped so the draft can never carry a question type the
        // platform does not support; the ERROR keeps it out of publishing.
        issues.push({
          level: 'ERROR',
          code: 'AI_UNKNOWN_QUESTION_TYPE',
          message: `Section ${index + 1}, group ${groupIndex + 1}: unknown question type "${type}" was ignored.`,
        });
        return null;
      }
      const meta = QUESTION_TYPE_META[type as QuestionType];

      const questions = group.questions.map((question) => {
        totalQuestions += 1;
        const key = buildAnswerKey(type, question.answer ?? null, group.sharedOptions);
        if (key) answeredQuestions += 1;

        return {
          number: question.number,
          prompt: question.prompt ?? '',
          options: question.options ?? [],
          config:
            type === 'MCQ_MULTI' && group.selectCount
              ? { selectCount: group.selectCount }
              : group.wordLimitMax
                ? { wordLimit: { max: group.wordLimitMax } }
                : {},
          answerKey: key,
          evidence: question.evidence ?? null,
          explanation: question.explanation ?? null,
        };
      });

      return {
        type,
        instructions: group.instructions ?? (meta ? meta.defaultInstructions : ''),
        sharedOptions: group.sharedOptions ?? [],
        config: {
          ...(group.selectCount ? { selectCount: group.selectCount } : {}),
          ...(group.wordLimitMax ? { wordLimit: { max: group.wordLimitMax } } : {}),
          ...(group.optionNumbering ? { optionNumbering: group.optionNumbering } : {}),
        },
        questions,
      } satisfies EditableGroup;
      })
      .filter((group): group is EditableGroup => group !== null);

    questionCount += groups.reduce((total, group) => total + group.questions.length, 0);

    return {
      skill: section.skill as Skill,
      title: section.title ?? '',
      instructions: section.instructions ?? '',
      passage: passage
        ? {
            title: passage.title ?? '',
            paragraphs: passage.paragraphs.map((p) => ({ label: p.label, text: p.text })),
            // Kept only so the review screen can flag an inflated declared count.
            passageWordCount: passage.passageWordCount ?? null,
          }
        : null,
      audioAssetId: null,
      groups,
    };
  });

  // Confidence is derived from what was actually converted, never from the
  // model's own self-report: an AI claim of PROVIDED must not hide gaps.
  const derivedConfidence: 'PROVIDED' | 'PARTIAL' | 'ABSENT' =
    answeredQuestions === 0 ? 'ABSENT' : answeredQuestions < totalQuestions ? 'PARTIAL' : 'PROVIDED';

  if (derivedConfidence === 'ABSENT') {
    issues.push({
      level: 'WARNING',
      code: 'AI_NO_ANSWER_KEY',
      message:
        'The source material did not contain a usable answer key. Nothing was invented: add the official answers manually before publishing.',
    });
  } else if (derivedConfidence === 'PARTIAL') {
    issues.push({
      level: 'WARNING',
      code: 'AI_PARTIAL_ANSWER_KEY',
      message: `Answers were extracted for ${answeredQuestions} of ${totalQuestions} questions${
        data.answerKeyConfidence === 'PROVIDED' ? ' (the model reported a complete key)' : ''
      }. Nothing was filled in automatically; review the missing answers before publishing.`,
    });
  }

  return {
    content: withImportDefaults({ sections }, data.testType),
    issues,
    answerKeyConfidence: derivedConfidence,
    questionCount,
  };
}

function buildAnswerKey(
  type: string,
  answer: string | null,
  sharedOptions: Array<{ id: string; text: string }>,
): AnswerKey | null {
  if (!answer || !isQuestionType(type)) return null;
  const meta = QUESTION_TYPE_META[type as QuestionType];
  const values = answer
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return null;

  if (meta.textAnswer) {
    return { kind: 'TEXT', accept: values };
  }

  if (type === 'TRUE_FALSE_NOT_GIVEN') {
    const mapped = values.map((value) => value.replace(/\s+/g, '_').toUpperCase());
    const valid = mapped.filter((value) => ['TRUE', 'FALSE', 'NOT_GIVEN'].includes(value));
    return valid.length > 0 ? { kind: 'CHOICE', values: valid } : null;
  }
  if (type === 'YES_NO_NOT_GIVEN') {
    const mapped = values.map((value) => value.replace(/\s+/g, '_').toUpperCase());
    const valid = mapped.filter((value) => ['YES', 'NO', 'NOT_GIVEN'].includes(value));
    return valid.length > 0 ? { kind: 'CHOICE', values: valid } : null;
  }

  // Choice types: prefer option ids; fall back to matching option text.
  const resolved = values.map((value) => {
    const direct = sharedOptions.find((option) => option.id.toLowerCase() === value.toLowerCase());
    if (direct) return direct.id;
    const byText = sharedOptions.find((option) => option.text.trim().toLowerCase() === value.toLowerCase());
    return byText ? byText.id : value;
  });

  return { kind: 'CHOICE', values: resolved, partialCredit: type === 'MCQ_MULTI' };
}

const SOURCE_QUESTION_TYPES: Record<string, string> = {
  matching_headings: 'MATCHING_HEADINGS',
  matching_information: 'MATCHING_INFORMATION',
  matching_features: 'MATCHING_FEATURES',
  true_false_not_given: 'TRUE_FALSE_NOT_GIVEN',
  yes_no_not_given: 'YES_NO_NOT_GIVEN',
  sentence_completion: 'SENTENCE_COMPLETION',
  summary_completion: 'SUMMARY_COMPLETION',
  note_completion: 'NOTE_COMPLETION',
  table_completion: 'TABLE_COMPLETION',
  flowchart_completion: 'FLOWCHART_COMPLETION',
  short_answer: 'SHORT_ANSWER',
  single_choice: 'MCQ_SINGLE',
  multiple_choice: 'MCQ_MULTI',
  mcq_single: 'MCQ_SINGLE',
  mcq_multi: 'MCQ_MULTI',
  writing_task_1: 'WRITING_TASK_1',
  writing_task_2: 'WRITING_TASK_2',
};

function looksLikeEditableContent(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const sections = (payload as { sections?: unknown }).sections;
  if (!Array.isArray(sections) || sections.length === 0) return false;
  const first = sections[0] as { groups?: unknown } | undefined;
  if (!first || !Array.isArray(first.groups) || first.groups.length === 0) return false;
  const group = first.groups[0] as { type?: unknown } | undefined;
  return typeof group?.type === 'string' && isQuestionType(group.type);
}

function looksLikeSourceDocument(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.sections) || record.sections.length === 0) return false;
  const first = record.sections[0] as Record<string, unknown> | undefined;
  return Boolean(first && Array.isArray(first.questionGroups));
}

// -----------------------------------------------------------------------------
// 32. Section-aware structured JSON import
//
// Accepts the documented format:
//   { testTitle, testType, sections: [ { sectionNumber, type, title, label,
//       order, passage, audio, transcript, prompt, minimumWords,
//       questionGroups: [ { questionType, instructions, fromQuestion,
//       toQuestion, options, configuration, questions } ] } ] }
// Nothing assumes a fixed number of passages/parts/tasks.
// -----------------------------------------------------------------------------

function looksLikeSectionedImport(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.sections) || record.sections.length === 0) return false;
  const first = record.sections[0] as Record<string, unknown> | undefined;
  if (!first) return false;
  // Distinguish from `looksLikeEditableContent` (already handled): the sectioned
  // format nests groups under `questionGroups`, not `groups`.
  return Array.isArray(first.questionGroups) || first.type != null || first.sectionNumber != null;
}

interface SectionedImportGroup {
  questionType?: unknown;
  type?: unknown;
  instructions?: unknown;
  fromQuestion?: unknown;
  toQuestion?: unknown;
  range?: unknown;
  options?: unknown;
  sharedOptions?: unknown;
  configuration?: unknown;
  config?: unknown;
  questions?: unknown;
}

interface SectionedImportSection {
  sectionNumber?: unknown;
  type?: unknown;
  skill?: unknown;
  title?: unknown;
  label?: unknown;
  order?: unknown;
  description?: unknown;
  instructions?: unknown;
  durationSeconds?: unknown;
  passage?: unknown;
  audio?: unknown;
  audioUrl?: unknown;
  transcript?: unknown;
  image?: unknown;
  imageUrl?: unknown;
  prompt?: unknown;
  minimumWords?: unknown;
  questionGroups?: unknown;
  groups?: unknown;
}

function sectionedImportToEditableContent(payload: unknown): ConvertedAiPayload {
  const record = payload as {
    testTitle?: unknown;
    title?: unknown;
    testType?: unknown;
    skill?: unknown;
    sections?: unknown;
    answerKey?: unknown;
    durationSeconds?: unknown;
    isCompleteTest?: unknown;
  };

  const issues: ValidationIssue[] = [];
  const rawSections = Array.isArray(record.sections) ? (record.sections as SectionedImportSection[]) : [];

  // Top-level answer keys (optional): { questionNumber, answer, evidence, explanation }.
  const answers = new Map<number, { answer: string; evidence: string | null; explanation: string | null }>();
  if (Array.isArray(record.answerKey)) {
    for (const row of record.answerKey as Array<Record<string, unknown>>) {
      const number = typeof row.questionNumber === 'number' ? row.questionNumber : Number(row.questionNumber);
      if (!Number.isInteger(number)) continue;
      const answer = typeof row.answer === 'string' ? row.answer : Array.isArray(row.acceptedAnswers) ? (row.acceptedAnswers as unknown[]).join(' | ') : null;
      answers.set(number, {
        answer: answer ?? '',
        evidence: typeof row.evidence === 'string' ? row.evidence : formatSourceEvidence(row.evidence),
        explanation: typeof row.explanation === 'string' ? row.explanation : null,
      });
    }
  }

  const sections: EditableContent['sections'] = rawSections.map((section, index) => {
    const sectionType = normaliseSectionType(strOr(section.type) ?? strOr(section.skill));
    const rawGroups = (section.questionGroups ?? section.groups) as SectionedImportGroup[] | undefined;
    const skill = sectionSkillOf(sectionType, strOr(section.skill));

    if (section.type != null && !sectionType) {
      issues.push({
        level: 'ERROR',
        code: 'INVALID_SECTION_TYPE',
        message: `Section ${index + 1} has an unknown type "${String(section.type)}" (use reading_passage, listening_part or writing_task).`,
      });
    }

    // Passage: { title, paragraphs: [{label,text}] | ["text", ...] }
    const passage = normalisePassageBlock(section.passage);

    // Audio: { url } | "https://…" — stored as a pasted URL; saving links it.
    const audioUrl = normaliseAudioBlock(section.audio) ?? strOr(section.audioUrl);

    const transcript = normaliseTranscriptBlock(section.transcript);

    const imageUrl = normaliseMediaUrl(section.image) ?? strOr(section.imageUrl);

    const groups = (Array.isArray(rawGroups) ? rawGroups : []).map((group, groupIndex): EditableGroup | null => {
      const rawType = strOr(group.questionType) ?? strOr(group.type) ?? '';
      const mappedType = resolveQuestionType(rawType);
      if (!mappedType) {
        issues.push({
          level: 'ERROR',
          code: 'AI_UNKNOWN_QUESTION_TYPE',
          message: `Section ${index + 1}, group ${groupIndex + 1}: unknown question type "${rawType}" was ignored.`,
        });
        return null;
      }
      const meta = QUESTION_TYPE_META[mappedType];
      const configuration = (group.configuration ?? group.config ?? {}) as Record<string, unknown>;

      const sharedOptions = normaliseOptionList(group.options ?? group.sharedOptions);
      const declared: Array<{ number: number; prompt: string; options: Array<{ id: string; text: string }>; answer: string | null; evidence: string | null; explanation: string | null }> =
        Array.isArray(group.questions)
          ? (group.questions as Array<Record<string, unknown>>).map((question, questionIndex) => ({
              number: intOr(question.number) ?? questionIndex + 1,
              prompt: strOr(question.prompt) ?? '',
              options: normaliseOptionList(question.options),
              answer: strOr(question.answer) ?? answers.get(intOr(question.number) ?? -1)?.answer ?? null,
              evidence: strOr(question.evidence) ?? answers.get(intOr(question.number) ?? -1)?.evidence ?? null,
              explanation: strOr(question.explanation) ?? answers.get(intOr(question.number) ?? -1)?.explanation ?? null,
            }))
          : [];

      // fromQuestion/toQuestion without explicit questions scaffolds the range.
      const from = intOr(group.fromQuestion);
      const to = intOr(group.toQuestion);
      const questions = declared.length > 0
        ? declared
        : from != null && to != null && to >= from && to - from < 60
          ? Array.from({ length: to - from + 1 }, (_, offset) => ({
              number: from + offset,
              prompt: '',
              options: [] as Array<{ id: string; text: string }>,
              answer: answers.get(from + offset)?.answer ?? null,
              evidence: answers.get(from + offset)?.evidence ?? null,
              explanation: answers.get(from + offset)?.explanation ?? null,
            }))
          : [];

      const config: Record<string, unknown> = {};
      const selectCount = intOr(configuration.selectCount);
      if (selectCount != null) config.selectCount = selectCount;
      const wordLimitMax = intOr(configuration.wordLimitMax ?? configuration.wordLimit);
      if (wordLimitMax != null) config.wordLimit = { max: wordLimitMax };
      const optionNumbering = strOr(configuration.optionNumbering);
      if (optionNumbering === 'roman' || optionNumbering === 'alpha' || optionNumbering === 'numeric') {
        config.optionNumbering = optionNumbering;
      }
      const minimumWords = intOr(configuration.minimumWords) ?? (mappedType === 'WRITING_TASK_1' || mappedType === 'WRITING_TASK_2' ? intOr(section.minimumWords) : null);
      if (minimumWords != null) config.minimumWords = minimumWords;

      return {
        type: mappedType,
        instructions: strOr(group.instructions) ?? (meta ? meta.defaultInstructions : ''),
        sharedOptions,
        config,
        rangeFrom: from ?? (questions.length > 0 ? Math.min(...questions.map((question) => question.number)) : null),
        rangeTo: to ?? (questions.length > 0 ? Math.max(...questions.map((question) => question.number)) : null),
        questions: questions.map((question) => {
          const key = buildAnswerKey(mappedType, question.answer, sharedOptions);
          return {
            number: question.number,
            prompt: question.prompt,
            options: question.options,
            config: {},
            answerKey: key,
            evidence: question.evidence,
            explanation: question.explanation,
          };
        }),
      } satisfies EditableGroup;
    }).filter((group): group is EditableGroup => group !== null);

    // Writing prompt: the section prompt doubles as the task question prompt.
    const prompt = strOr(section.prompt);
    if (skill === 'WRITING' && prompt) {
      const firstGroup = groups[0];
      if (firstGroup && firstGroup.questions.length > 0 && !firstGroup.questions[0]!.prompt) {
        firstGroup.questions[0]!.prompt = prompt;
      }
    }

    return {
      skill,
      type: sectionType ?? undefined,
      label: strOr(section.label) ?? undefined,
      title: strOr(section.title) ?? '',
      subtitle: null,
      description: strOr(section.description) ?? undefined,
      instructions: strOr(section.instructions) ?? '',
      durationSeconds: intOr(section.durationSeconds),
      order: intOr(section.order) ?? intOr(section.sectionNumber) ?? undefined,
      passage: passage,
      audioAssetId: null,
      audioUrl: audioUrl,
      imageAssetId: null,
      imageUrl: imageUrl,
      transcript: transcript,
      groups,
    } satisfies EditableSection;
  });

  // Explicit order wins over array position (33 reports duplicates later).
  const ordered = sections.every((section, index) => section.order === undefined || section.order === index)
    ? sections
    : sections
        .map((section, index) => ({ section, order: section.order ?? index }))
        .sort((a, b) => a.order - b.order)
        .map((entry) => entry.section);

  // Top-level test metadata declared by the documented one-file format is
  // honoured instead of dropped: the editor and Apply both keep the declared
  // duration / complete-test flag when present.
  const declaredDurationSeconds = intOr(record.durationSeconds);
  const declaredCompleteTest = typeof record.isCompleteTest === 'boolean' ? record.isCompleteTest : null;
  const content = withImportDefaults(
    {
      sections: ordered,
      ...(declaredDurationSeconds !== null ? { durationSeconds: declaredDurationSeconds } : {}),
      ...(declaredCompleteTest !== null ? { isCompleteTest: declaredCompleteTest } : {}),
    },
    inferTestTypeFromSections(ordered, record),
  );
  // Writing tasks are always teacher-marked, so they are excluded from the
  // answer-key confidence: an essay without an auto key is not a missing key.
  const isWritingGroup = (type: string) => type === 'WRITING_TASK_1' || type === 'WRITING_TASK_2';
  const questionCount = content.sections.reduce(
    (total, section) => total + section.groups.reduce((inner, group) => inner + group.questions.length, 0),
    0,
  );
  const answerableQuestions = content.sections.reduce(
    (total, section) => total + section.groups.reduce((inner, group) => inner + (isWritingGroup(group.type) ? 0 : group.questions.length), 0),
    0,
  );
  const answered = content.sections.reduce(
    (total, section) =>
      total +
      section.groups.reduce(
        (inner, group) =>
          inner +
          (isWritingGroup(group.type)
            ? 0
            : group.questions.filter((question) => Boolean(question.answerKey)).length),
        0,
      ),
    0,
  );
  const confidence: ConvertedAiPayload['answerKeyConfidence'] =
    answerableQuestions === 0 ? 'ABSENT' : answered < answerableQuestions ? 'PARTIAL' : 'PROVIDED';
  if (questionCount === 0) {
    issues.push({
      level: 'ERROR',
      code: 'SECTIONED_IMPORT_EMPTY',
      message: 'The structured file declares no questions. Check that each questionGroup lists its questions.',
    });
  }
  return { content, issues, answerKeyConfidence: confidence, questionCount };
}

function strOr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function intOr(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function resolveQuestionType(raw: string): QuestionType | null {
  if (!raw) return null;
  if (isQuestionType(raw)) return raw;
  const lower = raw.toLowerCase();
  if (isQuestionType(raw.toUpperCase().replace(/[\s-]+/g, '_'))) return raw.toUpperCase().replace(/[\s-]+/g, '_') as QuestionType;
  return (SOURCE_QUESTION_TYPES[lower] as QuestionType | undefined) ?? null;
}

function sectionSkillOf(sectionType: ReturnType<typeof normaliseSectionType>, declaredSkill: string | null): Skill {
  if (sectionType) return sectionTypeMeta(sectionType).skill;
  const upper = declaredSkill?.toUpperCase();
  if (upper === 'READING' || upper === 'LISTENING' || upper === 'WRITING') return upper;
  return 'READING';
}

function sectionTypeMeta(type: NonNullable<ReturnType<typeof normaliseSectionType>>): { skill: Skill } {
  return type === 'READING_PASSAGE' ? { skill: 'READING' } : type === 'LISTENING_PART' ? { skill: 'LISTENING' } : { skill: 'WRITING' };
}

function normalisePassageBlock(raw: unknown): EditableSection['passage'] | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return { title: '', paragraphs: raw.split(/\n{2,}/).map((text, index) => ({ label: String.fromCharCode(65 + index), text: text.trim() })) };
  }
  const block = raw as { title?: unknown; subtitle?: unknown; paragraphs?: unknown; wordCount?: unknown; body?: unknown };
  const paragraphsRaw = Array.isArray(block.paragraphs ?? block.body) ? (block.paragraphs ?? block.body) : null;
  const paragraphs = ((paragraphsRaw as unknown[] | null) ?? []).map((entry, index) => {
    if (typeof entry === 'string') return { label: String.fromCharCode(65 + index), text: entry };
    const record = entry as Record<string, unknown>;
    return {
      label: strOr(record.label) ?? String.fromCharCode(65 + index),
      text: strOr(record.text) ?? '',
    };
  }).filter((paragraph) => paragraph.text.length > 0);
  return {
    title: strOr(block.title) ?? '',
    subtitle: strOr(block.subtitle),
    paragraphs,
    passageWordCount: intOr(block.wordCount),
  };
}

function normaliseAudioBlock(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object') {
    const block = raw as { url?: unknown; assetId?: unknown; externalUrl?: unknown };
    return strOr(block.url) ?? strOr(block.externalUrl) ?? strOr(block.assetId);
  }
  return null;
}

function normaliseMediaUrl(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object') {
    const block = raw as { url?: unknown };
    return strOr(block.url);
  }
  return null;
}

function normaliseTranscriptBlock(raw: unknown): { segments: Array<{ id: string; startSeconds: number | null; speaker: string | null; text: string }> } | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    // Plain text transcript: one segment per non-empty line.
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return {
      segments: lines.map((text, index) => ({ id: `seg-${index + 1}`, startSeconds: null, speaker: null, text })),
    };
  }
  const block = raw as { segments?: unknown };
  if (!Array.isArray(block.segments)) return null;
  const segments = (block.segments as Array<Record<string, unknown>>).map((entry, index) => ({
    id: strOr(entry.id) ?? `seg-${index + 1}`,
    startSeconds: intOr(entry.startSeconds ?? entry.start ?? entry.offsetSeconds),
    speaker: strOr(entry.speaker ?? entry.speakerLabel),
    text: strOr(entry.text) ?? '',
  }));
  return segments.length > 0 ? { segments } : null;
}

function normaliseOptionList(raw: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  const options: Array<{ id: string; text: string }> = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const [id, ...rest] = entry.split('|');
      if (rest.length === 0) options.push({ id: String.fromCharCode(65 + options.length), text: entry.trim() });
      else options.push({ id: (id ?? '').trim(), text: rest.join('|').trim() });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const id = strOr(record.id) ?? strOr(record.value) ?? strOr(record.letter);
      const text = strOr(record.text) ?? strOr(record.label);
      if (id && text) options.push({ id, text });
    }
  }
  return options;
}

function inferTestTypeFromSections(sections: EditableSection[], record: { testType?: unknown; skill?: unknown }): 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK' {
  const declared = strOr(record.testType) ?? strOr(record.skill);
  if (declared && ['READING', 'LISTENING', 'WRITING', 'FULL_MOCK'].includes(declared.toUpperCase())) {
    return declared.toUpperCase() as 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK';
  }
  const skills = new Set(sections.map((section) => section.skill));
  if (skills.size > 1) return 'FULL_MOCK';
  const only = [...skills][0];
  return only === 'LISTENING' || only === 'WRITING' ? only : 'READING';
}

function fromEditableContent(content: EditableContent): ConvertedAiPayload {
  const questionCount = content.sections.reduce(
    (total, section) => total + section.groups.reduce((inner, group) => inner + group.questions.length, 0),
    0,
  );
  const answered = content.sections.reduce(
    (total, section) =>
      total +
      section.groups.reduce(
        (inner, group) => inner + group.questions.filter((question) => Boolean(question.answerKey)).length,
        0,
      ),
    0,
  );
  const confidence: ConvertedAiPayload['answerKeyConfidence'] =
    answered === 0 ? 'ABSENT' : answered < questionCount ? 'PARTIAL' : 'PROVIDED';
  return {
    content: withImportDefaults(content, inferTestType(content)),
    issues: [],
    answerKeyConfidence: confidence,
    questionCount,
  };
}

function sourceDocumentToAiPayload(payload: unknown): unknown {
  const record = payload as {
    metadata?: { title?: string; durationMinutes?: number };
    skill?: string;
    testTitle?: string;
    testType?: string;
    sections: Array<{
      title?: string;
      instructions?: string;
      passageWordCount?: number;
      passage?: { title?: string; paragraphs?: Array<{ label: string; text: string }> };
      questionGroups?: Array<{
        questionType?: string;
        instructions?: string;
        options?: Array<{ value?: string; label?: string; id?: string; text?: string }>;
        questions?: Array<{
          number: number;
          prompt?: string;
          options?: Array<{ value?: string; label?: string; id?: string; text?: string }>;
          wordLimit?: { maxWords?: number };
        }>;
      }>;
    }>;
    answerKey?: Array<{
      questionNumber: number;
      answer?: string;
      acceptedAnswers?: string[];
      evidence?: unknown;
      explanation?: string;
    }>;
  };

  const answers = new Map<number, { answer: string; evidence: string | null; explanation: string | null }>();
  for (const row of record.answerKey ?? []) {
    const answer = row.answer ?? row.acceptedAnswers?.[0] ?? '';
    answers.set(row.questionNumber, {
      answer,
      evidence: formatSourceEvidence(row.evidence),
      explanation: row.explanation ?? null,
    });
  }

  const passages = record.sections
    .map((section) =>
      section.passage
        ? {
            title: section.passage.title ?? section.title ?? '',
            passageWordCount: section.passageWordCount ?? null,
            paragraphs: (section.passage.paragraphs ?? []).map((paragraph) => ({
              label: paragraph.label,
              text: paragraph.text,
            })),
          }
        : null,
    )
    .filter((passage): passage is NonNullable<typeof passage> => passage !== null);

  const skill = (record.skill ?? record.testType ?? 'READING').toString().toUpperCase();
  const testType = ['READING', 'LISTENING', 'WRITING', 'FULL_MOCK'].includes(skill) ? skill : 'READING';

  return {
    testTitle: record.metadata?.title ?? record.testTitle ?? null,
    testType,
    answerKeyConfidence: answers.size > 0 ? 'PROVIDED' : 'ABSENT',
    warnings: [],
    passages,
    sections: record.sections.map((section, index) => ({
      skill: testType === 'FULL_MOCK' ? 'READING' : testType,
      title: section.title ?? '',
      instructions: section.instructions ?? '',
      passageIndex: section.passage ? Math.min(index, Math.max(passages.length - 1, 0)) : null,
      audioProvided: false,
      groups: (section.questionGroups ?? []).map((group) => {
        const mappedType = SOURCE_QUESTION_TYPES[(group.questionType ?? '').toLowerCase()] ?? group.questionType ?? '';
        const sharedOptions = (group.options ?? []).map(mapSourceOption).filter((option) => option.id);
        const wordLimitMax = group.questions?.find((question) => question.wordLimit?.maxWords)?.wordLimit?.maxWords ?? null;
        return {
          questionType: mappedType,
          instructions: group.instructions ?? '',
          optionNumbering: mappedType === 'MATCHING_HEADINGS' ? 'roman' : null,
          sharedOptions,
          selectCount: null,
          wordLimitMax,
          questions: (group.questions ?? []).map((question) => {
            const key = answers.get(question.number);
            const options = (question.options ?? []).map(mapSourceOption).filter((option) => option.id);
            return {
              number: question.number,
              prompt: question.prompt ?? '',
              options,
              answer: key?.answer ?? null,
              evidence: key?.evidence ?? null,
              explanation: key?.explanation ?? null,
            };
          }),
        };
      }),
    })),
  };
}

function mapSourceOption(option: { value?: string; label?: string; id?: string; text?: string }): { id: string; text: string } {
  return { id: option.id ?? option.value ?? '', text: option.text ?? option.label ?? '' };
}

function formatSourceEvidence(evidence: unknown): string | null {
  if (!evidence) return null;
  if (typeof evidence === 'string') return evidence;
  if (!Array.isArray(evidence)) return null;
  const parts = evidence
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as { paragraphLabel?: string; quote?: string };
      if (record.quote && record.paragraphLabel) return `Paragraph ${record.paragraphLabel}: “${record.quote}”`;
      if (record.quote) return `“${record.quote}”`;
      return null;
    })
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' ') : null;
}

export function withImportDefaults(
  content: EditableContent,
  testType: 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK',
): EditableContent {
  const durationSeconds =
    content.durationSeconds ?? (testType === 'LISTENING' ? 1800 : 3600);
  // Every imported section carries structural meaning: an explicit type when
  // given, otherwise the type implied by its skill; labels fall back to the
  // structural default ("Passage 2", "Part 3", "Task 1").
  const ordinalByType: Record<string, number> = {};
  const sections = content.sections.map((section) => {
    const type = sectionTypeOrSkillDefault(section.type, section.skill);
    ordinalByType[type] = (ordinalByType[type] ?? 0) + 1;
    const meta = SECTION_TYPE_META[type];
    return {
      ...section,
      type,
      label: section.label?.trim() ? section.label.trim() : `${meta.ordinalNoun} ${ordinalByType[type]}`,
      title: section.title?.trim() ? section.title : `${meta.ordinalNoun} ${ordinalByType[type]}`,
    };
  });
  return {
    ...content,
    sections,
    durationSeconds,
    isCompleteTest: content.isCompleteTest ?? true,
  };
}

function sectionTypeOrSkillDefault(type: string | null | undefined, skill: Skill): SectionType {
  const normalised = normaliseSectionType(typeof type === 'string' ? type : null);
  return normalised ?? defaultSectionTypeForSkill(skill);
}
export function inferTestType(content: { sections: Array<{ skill: Skill }> }): 'READING' | 'LISTENING' | 'WRITING' | 'FULL_MOCK' {
  const skills = new Set(content.sections.map((section) => section.skill));
  if (skills.size > 1) return 'FULL_MOCK';
  if (skills.has('LISTENING')) return 'LISTENING';
  if (skills.has('WRITING')) return 'WRITING';
  return 'READING';
}

// -----------------------------------------------------------------------------
// Client-facing entry point: accept either the platform's own content schema or
// any documented import format, and always return an editable content tree.
// -----------------------------------------------------------------------------

export interface EditableConversionResult {
  content: EditableContent;
  issues: ValidationIssue[];
  /** True when the payload had to be converted (i.e. it was not already editable content). */
  converted: boolean;
}

const PLATFORM_SKILLS: readonly string[] = ['READING', 'LISTENING', 'WRITING'];

function declaresPlatformSections(payload: unknown): boolean {
  if (!looksLikeEditableContent(payload)) return false;
  const sections = (payload as { sections?: Array<{ skill?: unknown }> }).sections ?? [];
  return (
    sections.length > 0 &&
    sections.every(
      (section) => typeof section.skill === 'string' && PLATFORM_SKILLS.includes(section.skill),
    )
  );
}

/**
 * Parses a pasted payload into editable content without ever throwing.
 *
 * Payloads already in the platform content schema pass through untouched; the
 * structured import format (`testType` + `sections[].questionGroups`), the flat
 * AI payload and the source-document format are converted deterministically.
 * Conversion problems are returned as issues instead of exceptions.
 */
export function parseIntoEditableContent(payload: unknown): EditableConversionResult {
  if (declaresPlatformSections(payload)) {
    return { content: payload as EditableContent, issues: [], converted: false };
  }
  const result = convertAiPayload(payload);
  return { content: result.content, issues: result.issues, converted: true };
}
