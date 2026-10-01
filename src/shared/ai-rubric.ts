/**
 * Rubric metadata shared by the Worker (which writes the grading prompts and
 * stores the result) and the browser (which renders the criteria bars).
 *
 * The descriptions are this project's own plain-language summary of what each
 * criterion looks at. They are deliberately short: they are shown under every
 * AI band so a candidate can see *why* the band was given. No third-party
 * descriptor text is reproduced here.
 */

export interface RubricCriterion {
  key: string;
  label: string;
  short: string;
  description: string;
}

export const WRITING_CRITERIA: RubricCriterion[] = [
  {
    key: 'TASK_ACHIEVEMENT',
    label: 'Task achievement',
    short: 'TA',
    description:
      'Does the response answer the task? Look for a clear position or overview, relevant ideas, developed support and respect for the word limit.',
  },
  {
    key: 'COHERENCE_COHESION',
    label: 'Coherence & cohesion',
    short: 'CC',
    description:
      'Is the message organised into paragraphs that progress logically? Look for sensible linking, clear referencing and no unexplained jumps.',
  },
  {
    key: 'LEXICAL_RESOURCE',
    label: 'Lexical resource',
    short: 'LR',
    description:
      'Range and precision of vocabulary, collocation and spelling. Look for topic-appropriate words used accurately, not rare words used wrongly.',
  },
  {
    key: 'GRAMMATICAL_RANGE',
    label: 'Grammatical range & accuracy',
    short: 'GRA',
    description:
      'Variety of sentence structures and how few errors appear. Look for complex sentences that stay accurate, and errors that do not obscure meaning.',
  },
];

export const SPEAKING_CRITERIA: RubricCriterion[] = [
  {
    key: 'FLUENCY_COHERENCE',
    label: 'Fluency & coherence',
    short: 'FC',
    description:
      'Ability to keep talking at a natural pace, connect ideas, and develop an answer without long, repeated hesitations.',
  },
  {
    key: 'LEXICAL_RESOURCE',
    label: 'Lexical resource',
    short: 'LR',
    description:
      'Vocabulary range and flexibility on unfamiliar topics, including paraphrase when the exact word is missing.',
  },
  {
    key: 'GRAMMATICAL_RANGE',
    label: 'Grammatical range & accuracy',
    short: 'GRA',
    description:
      'Variety and control of structures while speaking at speed, with errors that rarely interrupt understanding.',
  },
  {
    key: 'PRONUNCIATION',
    label: 'Pronunciation',
    short: 'P',
    description:
      'Clarity, stress and intonation. This criterion is only meaningful when a human or an audio-capable model listens to the recording.',
  },
];

export const RUBRIC_CRITERIA: Record<string, RubricCriterion> = Object.fromEntries(
  [...WRITING_CRITERIA, ...SPEAKING_CRITERIA].map((criterion) => [criterion.key, criterion]),
);

/** Word limits the platform suggests for the two Writing tasks. */
export const WRITING_TASK_MINIMUM_WORDS: Record<string, number> = {
  WRITING_TASK_1: 150,
  WRITING_TASK_2: 250,
};

export const BAND_DESCRIPTORS_NOTE =
  'Bands from the AI grader are an estimate for study feedback. They are not an official IELTS result and are not produced by IELTS, the British Council, IDP or Cambridge.';
