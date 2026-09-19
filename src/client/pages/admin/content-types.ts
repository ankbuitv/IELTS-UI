/**
 * Client-side mirror of the editable content payload accepted by
 * `PUT /api/admin/versions/:versionId/content`.
 *
 * The worker validates this shape with Zod; keeping the types here means the
 * editor and the API agree without exposing the server module to the bundle.
 */
import type { QuestionType, SharedOption, PassageParagraph } from '@shared/question-types';
import type { SectionType, TranscriptSegment } from '@shared/sections';

export interface WordLimitConfig {
  min?: number;
  max?: number;
}

export interface QuestionConfigInput {
  wordLimit?: WordLimitConfig;
  selectCount?: number;
  note?: string;
  optionNumbering?: 'roman' | 'alpha' | 'numeric';
  minimumWords?: number;
}

export type AnswerKeyInput =
  | { kind: 'CHOICE'; values: string[]; partialCredit?: boolean }
  | { kind: 'TEXT'; accept: string[]; numeric?: boolean; ignoreLeadingArticle?: boolean }
  | { kind: 'MANUAL' };

export interface QuestionBodyInput {
  kind: 'SUMMARY' | 'NOTES' | 'TABLE' | 'FLOWCHART';
  text?: string;
  rows?: string[][];
}

export interface EditableQuestion {
  number: number;
  prompt: string;
  options: SharedOption[];
  config: QuestionConfigInput;
  body?: QuestionBodyInput | null;
  answerKey?: AnswerKeyInput | null;
  evidence?: string | null;
  explanation?: string | null;
}

export interface EditableGroup {
  type: QuestionType;
  instructions: string;
  sharedOptions: SharedOption[];
  config: QuestionConfigInput;
  rangeFrom?: number | null;
  rangeTo?: number | null;
  questions: EditableQuestion[];
}

export interface PlaybackInput {
  maxPlays?: number;
  prepSeconds?: number;
  allowPause?: boolean;
  allowSeekAfterPlay?: boolean;
}

export interface EditableSection {
  skill: 'READING' | 'LISTENING' | 'WRITING';
  /** Normalised structural type (READING_PASSAGE | LISTENING_PART | WRITING_TASK). */
  type?: SectionType | string | null;
  /** Short display label ("Passage 1", "Part 2", "Task 1"). */
  label?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  instructions: string;
  durationSeconds?: number | null;
  passage?: { title: string; subtitle?: string | null; paragraphs: PassageParagraph[] } | null;
  audioAssetId?: string | null;
  audioUrl?: string | null;
  playback?: PlaybackInput;
  /** Segment-based listening transcript. */
  transcript?: { segments: TranscriptSegment[] } | null;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  /** Explicit order hint; the persisted order is the array position. */
  order?: number | null;
  groups: EditableGroup[];
}

export interface EditableMockComponent {
  skill: 'READING' | 'LISTENING' | 'WRITING';
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

// ---------------------------------------------------------------------------
// Wire types (server responses)
// ---------------------------------------------------------------------------
export interface AdminAssetRow {
  id: string;
  kind: string;
  filename: string;
  mime: string;
  size_bytes: number;
  duration_seconds: number | null;
  alt_text: string | null;
  visibility: string;
  test_version_id: string | null;
  test_title?: string | null;
}

interface AdminQuestionRow {
  number: number;
  prompt: string;
  options: SharedOption[];
  config: QuestionConfigInput;
  body: QuestionBodyInput | null;
  answerKey: AnswerKeyInput | null;
  evidence: string | null;
  explanation: string | null;
}

interface AdminGroupRow {
  type: QuestionType;
  instructions: string;
  sharedOptions: SharedOption[];
  config: QuestionConfigInput;
  rangeFrom: number | null;
  rangeTo: number | null;
  questions: AdminQuestionRow[];
}

interface AdminSectionRow {
  id: string;
  skill: EditableSection['skill'];
  orderIndex: number;
  type: SectionType | string | null;
  label: string;
  title: string;
  subtitle: string | null;
  description: string;
  instructions: string;
  durationSeconds: number | null;
  passage: { title: string; subtitle: string | null; paragraphs: PassageParagraph[]; wordCount: number } | null;
  audioAssetId: string | null;
  playback: PlaybackInput;
  transcript: { segments: TranscriptSegment[] } | null;
  imageAssetId: string | null;
  groups: AdminGroupRow[];
}

export interface AdminVersionContentResponse {
  test: {
    id: string;
    slug: string;
    title: string;
    type: string;
    status: string;
    summary: string;
    contentOrigin: string;
    sourceTitle: string | null;
    sourceUrl: string | null;
    attribution: string | null;
    licenseNotes: string | null;
  };
  version: {
    id: string;
    testId: string;
    versionNumber: number;
    status: string;
    changeNote: string;
    totalQuestions: number;
    durationSeconds: number | null;
    isCompleteTest: boolean;
    scoringProfileId: string | null;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sections: AdminSectionRow[];
  assets: AdminAssetRow[];
  mockComponents: Array<{
    skill: EditableMockComponent['skill'];
    testVersionId: string;
    label: string;
    durationSeconds: number;
    breakAfterSeconds: number;
    referenceTitle?: string;
  }>;
  attemptCount: number;
  editable: boolean;
}

export function toEditable(content: AdminVersionContentResponse): EditableContent {
  return {
    sections: content.sections.map((section, index) => ({
      skill: section.skill,
      type: section.type,
      label: section.label,
      description: section.description,
      order: index,
      title: section.title,
      subtitle: section.subtitle,
      instructions: section.instructions,
      durationSeconds: section.durationSeconds,
      passage: section.passage
        ? {
            title: section.passage.title,
            subtitle: section.passage.subtitle,
            paragraphs: section.passage.paragraphs.map((paragraph) => ({
              label: paragraph.label ?? '',
              text: paragraph.text ?? '',
            })),
          }
        : null,
      audioAssetId: section.audioAssetId,
      playback: { ...section.playback },
      transcript: section.transcript ? { segments: section.transcript.segments.map((segment) => ({ ...segment })) } : null,
      imageAssetId: section.imageAssetId ?? null,
      imageUrl: null,
      groups: section.groups.map((group) => ({
        type: group.type,
        instructions: group.instructions,
        sharedOptions: group.sharedOptions.map((option) => ({ ...option })),
        config: { ...group.config },
        rangeFrom: group.rangeFrom,
        rangeTo: group.rangeTo,
        questions: group.questions.map((question) => ({
          number: question.number,
          prompt: question.prompt,
          options: question.options.map((option) => ({ ...option })),
          config: { ...question.config },
          body: question.body ?? null,
          answerKey: question.answerKey ?? null,
          evidence: question.evidence,
          explanation: question.explanation,
        })),
      })),
    })),
    mockComponents: content.mockComponents.map((component) => ({
      skill: component.skill,
      testVersionId: component.testVersionId,
      label: component.label,
      durationSeconds: component.durationSeconds,
      breakAfterSeconds: component.breakAfterSeconds,
    })),
    durationSeconds: content.version.durationSeconds,
    isCompleteTest: content.version.isCompleteTest,
    scoringProfileId: content.version.scoringProfileId,
  };
}

export function emptyGroup(type: QuestionType = 'SHORT_ANSWER'): EditableGroup {
  return { type, instructions: '', sharedOptions: [], config: {}, rangeFrom: null, rangeTo: null, questions: [] };
}

export function emptyQuestion(number: number): EditableQuestion {
  return { number, prompt: '', options: [], config: {}, answerKey: null, evidence: null, explanation: null };
}

export function emptySection(skill: EditableSection['skill'] = 'READING', ordinal = 1): EditableSection {
  const noun = skill === 'READING' ? 'Passage' : skill === 'LISTENING' ? 'Part' : 'Task';
  return {
    skill,
    type: skill === 'READING' ? 'READING_PASSAGE' : skill === 'LISTENING' ? 'LISTENING_PART' : 'WRITING_TASK',
    label: `${noun} ${ordinal}`,
    title:
      skill === 'READING'
        ? `Reading Passage ${ordinal}`
        : skill === 'LISTENING'
          ? `Listening Part ${ordinal}`
          : `Writing Task ${ordinal}`,
    subtitle: null,
    description: '',
    instructions: '',
    durationSeconds: skill === 'READING' ? 1200 : skill === 'LISTENING' ? 600 : 1200,
    passage: skill === 'READING' ? { title: '', subtitle: null, paragraphs: [{ label: 'A', text: '' }] } : null,
    audioAssetId: null,
    audioUrl: null,
    playback: {},
    transcript: null,
    imageAssetId: null,
    imageUrl: null,
    order: null,
    groups: [
      emptyGroup(
        skill === 'WRITING' ? 'WRITING_TASK_1' : skill === 'LISTENING' ? 'SHORT_ANSWER' : 'TRUE_FALSE_NOT_GIVEN',
      ),
    ],
  };
}

/** Deep clone used by "Duplicate section". */
export function duplicateSection(section: EditableSection): EditableSection {
  return {
    ...section,
    title: `${section.title || 'Section'} (copy)`,
    label: section.label ? `${section.label} (copy)` : null,
    passage: section.passage
      ? {
          ...section.passage,
          paragraphs: section.passage.paragraphs.map((paragraph) => ({ ...paragraph })),
        }
      : null,
    transcript: section.transcript
      ? { segments: section.transcript.segments.map((segment) => ({ ...segment })) }
      : null,
    groups: section.groups.map((group) => ({
      ...group,
      config: { ...group.config },
      sharedOptions: group.sharedOptions.map((option) => ({ ...option })),
      questions: group.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option })),
        config: { ...question.config },
        body: question.body ? { ...question.body, rows: question.body.rows?.map((row) => [...row]) } : null,
        answerKey: question.answerKey
          ? question.answerKey.kind === 'CHOICE'
            ? { ...question.answerKey, values: [...question.answerKey.values] }
            : question.answerKey.kind === 'TEXT'
              ? { ...question.answerKey, accept: [...question.answerKey.accept] }
              : { ...question.answerKey }
          : null,
      })),
    })),
  };
}

/** Moves a section by +1/-1 with wraparound-free clamping. */
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** `[[3]]`-style blanks are how completion questions are numbered inline. */
export function countAnswersForGroup(group: EditableGroup): number {
  const explicit = group.questions.length;
  const inline = group.questions.reduce((total, question) => {
    const matches = question.prompt.match(/\[\[\d+\]\]/g);
    return total + (matches ? matches.length : 0);
  }, 0);
  return Math.max(explicit, inline);
}
