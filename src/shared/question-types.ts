/**
 * The question engine's type registry.
 *
 * IMPORTANT: this file is shared with the browser and therefore documents only
 * the *shape* of candidate-visible data. Correct answers live in `answer_keys`
 * (server-only) and are never represented here.
 */
import type { Skill } from './types';
import type { SectionPolicy, SectionTranscript, SectionType } from './sections';

export const QUESTION_TYPES = [
  'TRUE_FALSE_NOT_GIVEN',
  'YES_NO_NOT_GIVEN',
  'MCQ_SINGLE',
  'MCQ_MULTI',
  'MATCHING_INFORMATION',
  'MATCHING_HEADINGS',
  'MATCHING_FEATURES',
  'SENTENCE_COMPLETION',
  'SUMMARY_COMPLETION',
  'NOTE_COMPLETION',
  'TABLE_COMPLETION',
  'FLOWCHART_COMPLETION',
  'SHORT_ANSWER',
  'WRITING_TASK_1',
  'WRITING_TASK_2',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Which UI control family renders a question type. */
export type ControlKind =
  | 'TFNG'
  | 'YNN'
  | 'RADIO'
  | 'CHECKBOX'
  | 'MATCH_SELECT'
  | 'TEXT'
  | 'ESSAY';

export interface QuestionTypeMeta {
  type: QuestionType;
  label: string;
  control: ControlKind;
  skills: Skill[];
  /** True when the answer key is a set of agreed textual variants. */
  textAnswer: boolean;
  /** True when partial credit is possible (e.g. multi-select with 2 of 3). */
  partialCredit: boolean;
  /** Candidate-facing instructions default. */
  defaultInstructions: string;
  /** Whether the group needs a shared option bank. */
  needsSharedOptions: boolean;
  /** How many selections the candidate must make (for multi-select types). */
  selectCount?: number;
}

const TFNG_VALUES = ['TRUE', 'FALSE', 'NOT_GIVEN'] as const;
const YNN_VALUES = ['YES', 'NO', 'NOT_GIVEN'] as const;

export const TFNG_OPTIONS = [...TFNG_VALUES];
export const YNN_OPTIONS = [...YNN_VALUES];
export type TfngValue = (typeof TFNG_VALUES)[number];
export type YnnValue = (typeof YNN_VALUES)[number];

export const QUESTION_TYPE_META: Record<QuestionType, QuestionTypeMeta> = {
  TRUE_FALSE_NOT_GIVEN: {
    type: 'TRUE_FALSE_NOT_GIVEN',
    label: 'True / False / Not Given',
    control: 'TFNG',
    skills: ['READING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      'Do the following statements agree with the information given in the passage? Write TRUE if the statement agrees with the information, FALSE if the statement contradicts the information, or NOT GIVEN if there is no information on this.',
    needsSharedOptions: false,
  },
  YES_NO_NOT_GIVEN: {
    type: 'YES_NO_NOT_GIVEN',
    label: 'Yes / No / Not Given',
    control: 'YNN',
    skills: ['READING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      "Do the following statements agree with the claims of the writer? Write YES if the statement agrees with the claims of the writer, NO if the statement contradicts the claims of the writer, or NOT GIVEN if it is impossible to say what the writer thinks about this.",
    needsSharedOptions: false,
  },
  MCQ_SINGLE: {
    type: 'MCQ_SINGLE',
    label: 'Multiple choice (one answer)',
    control: 'RADIO',
    skills: ['READING', 'LISTENING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions: 'Choose the correct answer.',
    needsSharedOptions: false,
  },
  MCQ_MULTI: {
    type: 'MCQ_MULTI',
    label: 'Multiple choice (multiple answers)',
    control: 'CHECKBOX',
    skills: ['READING', 'LISTENING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions: 'Choose TWO letters.',
    needsSharedOptions: false,
  },
  MATCHING_INFORMATION: {
    type: 'MATCHING_INFORMATION',
    label: 'Matching information',
    control: 'MATCH_SELECT',
    skills: ['READING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      'Which paragraph contains the following information? Write the correct letter in the box. You may use any letter more than once.',
    needsSharedOptions: true,
  },
  MATCHING_HEADINGS: {
    type: 'MATCHING_HEADINGS',
    label: 'Matching headings',
    control: 'MATCH_SELECT',
    skills: ['READING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      'Choose the correct heading for each section from the list of headings below. Write the correct number, i–x, in the box.',
    needsSharedOptions: true,
  },
  MATCHING_FEATURES: {
    type: 'MATCHING_FEATURES',
    label: 'Matching features',
    control: 'MATCH_SELECT',
    skills: ['READING', 'LISTENING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      'Match each statement with the correct option. Write the correct letter in the box.',
    needsSharedOptions: true,
  },
  SENTENCE_COMPLETION: {
    type: 'SENTENCE_COMPLETION',
    label: 'Sentence completion',
    control: 'TEXT',
    skills: ['READING', 'LISTENING'],
    textAnswer: true,
    partialCredit: false,
    defaultInstructions:
      'Complete the sentences below. Write ONE WORD ONLY for each answer (unless the task states otherwise).',
    needsSharedOptions: false,
  },
  SUMMARY_COMPLETION: {
    type: 'SUMMARY_COMPLETION',
    label: 'Summary completion',
    control: 'TEXT',
    skills: ['READING', 'LISTENING'],
    textAnswer: true,
    partialCredit: false,
    defaultInstructions: 'Complete the summary below. Write ONE WORD ONLY for each answer.',
    needsSharedOptions: false,
  },
  NOTE_COMPLETION: {
    type: 'NOTE_COMPLETION',
    label: 'Note completion',
    control: 'TEXT',
    skills: ['READING', 'LISTENING'],
    textAnswer: true,
    partialCredit: false,
    defaultInstructions: 'Complete the notes below. Write ONE WORD AND/OR A NUMBER for each answer.',
    needsSharedOptions: false,
  },
  TABLE_COMPLETION: {
    type: 'TABLE_COMPLETION',
    label: 'Table completion',
    control: 'TEXT',
    skills: ['READING', 'LISTENING'],
    textAnswer: true,
    partialCredit: false,
    defaultInstructions: 'Complete the table below. Write ONE WORD ONLY for each answer.',
    needsSharedOptions: false,
  },
  FLOWCHART_COMPLETION: {
    type: 'FLOWCHART_COMPLETION',
    label: 'Flow-chart completion',
    control: 'TEXT',
    skills: ['READING', 'LISTENING'],
    textAnswer: true,
    partialCredit: false,
    defaultInstructions: 'Complete the flow-chart below. Write NO MORE THAN TWO WORDS for each answer.',
    needsSharedOptions: false,
  },
  SHORT_ANSWER: {
    type: 'SHORT_ANSWER',
    label: 'Short answer questions',
    control: 'TEXT',
    skills: ['READING', 'LISTENING'],
    textAnswer: true,
    partialCredit: false,
    defaultInstructions:
      'Answer the questions below. Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.',
    needsSharedOptions: false,
  },
  WRITING_TASK_1: {
    type: 'WRITING_TASK_1',
    label: 'Writing Task 1',
    control: 'ESSAY',
    skills: ['WRITING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      'You should spend about 20 minutes on this task. Write at least 150 words. You should write your answer in the box below.',
    needsSharedOptions: false,
  },
  WRITING_TASK_2: {
    type: 'WRITING_TASK_2',
    label: 'Writing Task 2',
    control: 'ESSAY',
    skills: ['WRITING'],
    textAnswer: false,
    partialCredit: false,
    defaultInstructions:
      'You should spend about 40 minutes on this task. Write at least 250 words. Give reasons for your answer and include any relevant examples from your own knowledge or experience.',
    needsSharedOptions: false,
  },
};

export function isQuestionType(value: string): value is QuestionType {
  return (QUESTION_TYPES as readonly string[]).includes(value);
}

export function questionTypeMeta(type: string): QuestionTypeMeta {
  if (!isQuestionType(type)) {
    throw new Error(`Unknown question type: ${type}`);
  }
  return QUESTION_TYPE_META[type];
}

export function controlForType(type: string): ControlKind {
  if (!isQuestionType(type)) return 'TEXT';
  return QUESTION_TYPE_META[type].control;
}

export function defaultPointsForType(_type: QuestionType): number {
  return 1;
}

/** A heading / option bank entry (candidate visible). */
export interface SharedOption {
  /** Stable identifier the candidate's answer references (e.g. "iii" or "B"). */
  id: string;
  text: string;
}

export interface QuestionGroupConfig {
  /** e.g. { maxWords: 1, minWords: 1 } */
  wordLimit?: { min?: number; max?: number };
  /** For MCQ_MULTI: how many items must be selected. */
  selectCount?: number;
  /** Free-form candidate-visible instruction supplement. */
  note?: string;
  /** For matching headings, the numbering style: 'roman' | 'alpha' | 'numeric'. */
  optionNumbering?: 'roman' | 'alpha' | 'numeric';
  /** For WRITING_TASK groups: the candidate-visible minimum word count. */
  minimumWords?: number;
}

export interface PassageParagraph {
  label: string;
  text: string;
}

/** Candidate-visible question payload (never contains answers). */
export interface CandidateQuestion {
  id: string;
  number: number;
  prompt: string;
  options: SharedOption[];
  config: QuestionGroupConfig;
  /**
   * Optional candidate-visible scaffolding for completion tasks
   * (e.g. the summary/notes body with `[[6]]` placeholders).
   */
  body?: { kind: 'SUMMARY' | 'NOTES' | 'TABLE' | 'FLOWCHART'; text?: string; rows?: string[][] } | null;
}

export interface CandidateQuestionGroup {
  id: string;
  type: QuestionType;
  instructions: string;
  sharedOptions: SharedOption[];
  config: QuestionGroupConfig;
  rangeFrom: number | null;
  rangeTo: number | null;
  questions: CandidateQuestion[];
}

export interface CandidatePassage {
  id: string;
  title: string;
  subtitle: string | null;
  paragraphs: PassageParagraph[];
  wordCount: number;
}

export interface CandidateAudio {
  assetId: string;
  url: string;
  durationSeconds: number | null;
  playback: AudioPlaybackPolicy;
}

export interface CandidateImage {
  assetId: string;
  url: string;
  altText: string | null;
}

export interface AudioPlaybackPolicy {
  /** How many times the recording may be played. 1 = exam standard. */
  maxPlays: number;
  /** Seconds of preparation before playback is enabled. */
  prepSeconds: number;
  /** Allow pausing once playback has started. */
  allowPause: boolean;
  /** Free navigation within the recording after it has played once. */
  allowSeekAfterPlay: boolean;
}

export const DEFAULT_AUDIO_POLICY: AudioPlaybackPolicy = {
  maxPlays: 1,
  prepSeconds: 0,
  allowPause: true,
  allowSeekAfterPlay: false,
};

export interface CandidateSection {
  id: string;
  skill: Skill;
  orderIndex: number;
  /** Normalised structural type — READING_PASSAGE | LISTENING_PART | WRITING_TASK (29). */
  type: SectionType;
  /** Short display label ("Passage 1", "Part 2", "Task 1"); falls back structurally. */
  label: string;
  title: string;
  subtitle: string | null;
  /** One-line candidate-facing description of the section. */
  description: string;
  instructions: string;
  durationSeconds: number | null;
  passage: CandidatePassage | null;
  audio: CandidateAudio | null;
  /** Optional diagram / chart media shown with the section. */
  image: CandidateImage | null;
  /** Listening transcript — only exposed when the payload policy allows it. */
  transcript: SectionTranscript | null;
  groups: CandidateQuestionGroup[];
  /** Writing tasks are rendered as essays rather than numbered questions. */
  writingTasks: CandidateQuestion[];
  questionNumbers: number[];
}

export type { SectionPolicy, SectionTranscript, SectionType };
