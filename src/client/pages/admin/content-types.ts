/**
 * Client-side mirror of the editable content payload accepted by
 * `PUT /api/admin/versions/:versionId/content`.
 *
 * The worker validates this shape with Zod; keeping the types here means the
 * editor and the API agree without exposing the server module to the bundle.
 */
import type { QuestionType, SharedOption, PassageParagraph } from '@shared/question-types';

export interface WordLimitConfig {
  min?: number;
  max?: number;
}

export interface QuestionConfigInput {
  wordLimit?: WordLimitConfig;
  selectCount?: number;
  note?: string;
  optionNumbering?: 'roman' | 'alpha' | 'numeric';
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
  title: string;
  subtitle?: string | null;
  instructions: string;
  durationSeconds?: number | null;
  passage?: { title: string; subtitle?: string | null; paragraphs: PassageParagraph[] } | null;
  audioAssetId?: string | null;
  audioUrl?: string | null;
  playback?: PlaybackInput;
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
  skill: EditableSection['skill'];
  title: string;
  subtitle: string | null;
  instructions: string;
  durationSeconds: number | null;
  passage: { title: string; subtitle: string | null; paragraphs: PassageParagraph[]; wordCount: number } | null;
  audioAssetId: string | null;
  playback: PlaybackInput;
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
    sections: content.sections.map((section) => ({
      skill: section.skill,
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

export function emptySection(skill: EditableSection['skill'] = 'READING'): EditableSection {
  return {
    skill,
    title: skill === 'READING' ? 'Reading Passage 1' : skill === 'LISTENING' ? 'Listening Part 1' : 'Writing Task 1',
    subtitle: null,
    instructions: '',
    durationSeconds: skill === 'READING' ? 1200 : skill === 'LISTENING' ? 1800 : 1200,
    passage: skill === 'READING' ? { title: '', subtitle: null, paragraphs: [{ label: 'A', text: '' }] } : null,
    audioAssetId: null,
    playback: {},
    groups: [
      emptyGroup(
        skill === 'WRITING' ? 'WRITING_TASK_1' : skill === 'LISTENING' ? 'SHORT_ANSWER' : 'TRUE_FALSE_NOT_GIVEN',
      ),
    ],
  };
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
