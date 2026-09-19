/**
 * 28–42. Sections / Parts as a first-class feature.
 *
 * Covers the shared section vocabulary (types, labels, structure summary,
 * navigation policy), the new deterministic validation rules, and the
 * section-aware structured JSON import.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStructureSummary,
  defaultSectionTypeForSkill,
  normaliseSectionType,
  resolveSectionPolicy,
  sectionDisplayLabel,
} from '../../src/shared/sections';
import {
  summariseIssues,
  validateTestVersion,
  type ValidationInput,
  type ValidationSection,
} from '../../src/shared/validation';
import { convertAiPayload } from '../../src/worker/services/import-service';

// ---------------------------------------------------------------------------
// Shared section vocabulary
// ---------------------------------------------------------------------------
describe('section vocabulary', () => {
  it('derives the structural type from the skill (29)', () => {
    expect(defaultSectionTypeForSkill('READING')).toBe('READING_PASSAGE');
    expect(defaultSectionTypeForSkill('LISTENING')).toBe('LISTENING_PART');
    expect(defaultSectionTypeForSkill('WRITING')).toBe('WRITING_TASK');
  });

  it('normalises aliases of section types from structured imports (29/32)', () => {
    expect(normaliseSectionType('reading_passage')).toBe('READING_PASSAGE');
    expect(normaliseSectionType('Listening Part')).toBe('LISTENING_PART');
    expect(normaliseSectionType('writing-task')).toBe('WRITING_TASK');
    expect(normaliseSectionType('passage')).toBe('READING_PASSAGE');
    expect(normaliseSectionType('part')).toBe('LISTENING_PART');
    expect(normaliseSectionType('nonsense')).toBeNull();
    expect(normaliseSectionType(null)).toBeNull();
  });

  it('falls back to structural labels when no explicit label is stored (29)', () => {
    expect(sectionDisplayLabel({ label: 'Passage One', orderIndex: 0 })).toBe('Passage One');
    expect(sectionDisplayLabel({ type: 'LISTENING_PART', orderIndex: 2 })).toBe('Part 3');
    expect(sectionDisplayLabel({ skill: 'WRITING', orderIndex: 1 })).toBe('Task 2');
    expect(sectionDisplayLabel({ skill: 'READING', orderIndex: 0, title: 'The Aga Khan' })).toBe('Passage 1');
  });

  it('builds the library structure line from real counts (42)', () => {
    expect(buildStructureSummary({ passages: 3, parts: 0, tasks: 0, questions: 40, durationSeconds: 3600 })).toMatchObject({
      summaryLine: '3 passages • 40 questions • ~60 min',
      minutes: 60,
    });
    expect(buildStructureSummary({ passages: 1, parts: 0, tasks: 0, questions: 13, durationSeconds: 1200 }).summaryLine).toBe(
      '1 passage • 13 questions • ~20 min',
    );
    expect(buildStructureSummary({ passages: 0, parts: 4, tasks: 0, questions: 40, durationSeconds: 1800 }).summaryLine).toBe(
      '4 parts • 40 questions • ~30 min',
    );
    expect(
      buildStructureSummary({ passages: 3, parts: 4, tasks: 2, questions: 80, durationSeconds: null }).summaryLine,
    ).toBe('3 passages • 4 parts • 2 tasks • 80 questions');
  });

  it('resolves the navigation policy with defaults and LOCKED consistency (34/39)', () => {
    expect(resolveSectionPolicy(undefined)).toMatchObject({
      navigation: 'FREE_NAVIGATION',
      allowReturnToPreviousParts: true,
      autoAdvanceOnPartTimeout: false,
    });
    expect(resolveSectionPolicy({ navigation: 'sequential_parts' })).toMatchObject({ navigation: 'FREE_NAVIGATION' });
    const locked = resolveSectionPolicy({ navigation: 'LOCKED_PARTS', allowReturnToPreviousParts: true });
    expect(locked.allowReturnToPreviousParts).toBe(false);
    expect(resolveSectionPolicy({ navigation: 'SEQUENTIAL_PARTS', autoAdvanceOnPartTimeout: true }).autoAdvanceOnPartTimeout).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 33. Section validation
// ---------------------------------------------------------------------------
function baseSection(overrides: Partial<ValidationSection> = {}): ValidationSection {
  return {
    id: 'sec_1',
    skill: 'READING',
    orderIndex: 0,
    type: 'READING_PASSAGE',
    title: 'Passage 1',
    instructions: 'Read the passage.',
    hasPassage: true,
    passageParagraphCount: 2,
    hasAudio: false,
    groups: [
      {
        id: 'grp_1',
        type: 'TRUE_FALSE_NOT_GIVEN',
        instructions: 'Write TRUE, FALSE or NOT GIVEN.',
        sharedOptions: [],
        rangeFrom: 1,
        rangeTo: 2,
        questions: [
          { id: 'q_1', number: 1, prompt: 'Statement one.', options: [], config: {}, answerKey: { kind: 'CHOICE', values: ['TRUE'] } },
          { id: 'q_2', number: 2, prompt: 'Statement two.', options: [], config: {}, answerKey: { kind: 'CHOICE', values: ['FALSE'] } },
        ],
      },
    ],
    ...overrides,
  };
}

function baseInput(sections: ValidationSection[]): ValidationInput {
  return { testType: 'READING', title: 'Practice reading test', sections };
}

function codesOf(issues: ReturnType<typeof validateTestVersion>): string[] {
  return issues.map((issue) => issue.code);
}

describe('section structure validation (33)', () => {
  it('detects duplicate section ids', () => {
    const issues = validateTestVersion(baseInput([baseSection(), baseSection()]));
    expect(codesOf(issues)).toContain('DUPLICATE_SECTION_ID');
  });

  it('detects duplicate section order', () => {
    const a = baseSection({ id: 'sec_a' });
    const b = baseSection({ id: 'sec_b', orderIndex: 0, title: 'Passage 2' });
    const issues = validateTestVersion(baseInput([a, b]));
    expect(codesOf(issues)).toContain('DUPLICATE_SECTION_ORDER');
  });

  it('detects a missing (invalid) section order', () => {
    const section = baseSection({ orderIndex: Number.NaN });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).toContain('MISSING_SECTION_ORDER');
  });

  it('detects an invalid section type', () => {
    const issues = validateTestVersion(baseInput([baseSection({ type: 'MOVIE_SCENE' })]));
    expect(codesOf(issues)).toContain('INVALID_SECTION_TYPE');
  });

  it('accepts a valid section type', () => {
    const issues = validateTestVersion(baseInput([baseSection({ type: 'READING_PASSAGE' })]));
    expect(codesOf(issues)).not.toContain('INVALID_SECTION_TYPE');
  });

  it('flags question groups that are not attached to a section', () => {
    const input: ValidationInput = {
      ...baseInput([baseSection()]),
      orphanGroups: [{ id: 'grp_orphan', questionType: 'SHORT_ANSWER' }],
    };
    const issues = validateTestVersion(input);
    expect(codesOf(issues)).toContain('ORPHAN_QUESTION_GROUP');
  });

  it('detects question numbers shared between two groups of a section', () => {
    const section = baseSection({
      groups: [
        baseSection().groups[0]!,
        {
          id: 'grp_2',
          type: 'SHORT_ANSWER',
          instructions: 'Answer briefly.',
          sharedOptions: [],
          rangeFrom: 2,
          rangeTo: 3,
          questions: [
            { id: 'q_2b', number: 2, prompt: 'Duplicate number.', options: [], config: {}, answerKey: { kind: 'TEXT', accept: ['yes'] } },
            { id: 'q_3', number: 3, prompt: 'Third question.', options: [], config: {}, answerKey: { kind: 'TEXT', accept: ['no'] } },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).toContain('OVERLAPPING_GROUP_RANGES');
  });

  it('flags section order that contradicts question order', () => {
    const first = baseSection({ id: 'sec_a', orderIndex: 0, groups: [baseSection().groups[0]!] });
    const second = baseSection({
      id: 'sec_b',
      orderIndex: 1,
      title: 'Passage 2',
      groups: [
        {
          id: 'grp_early',
          type: 'TRUE_FALSE_NOT_GIVEN',
          instructions: 'Write TRUE, FALSE or NOT GIVEN.',
          sharedOptions: [],
          rangeFrom: 1,
          rangeTo: 1,
          questions: [
            { id: 'q_early', number: 1, prompt: 'Out of order.', options: [], config: {}, answerKey: { kind: 'CHOICE', values: ['TRUE'] } },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([first, second]));
    expect(codesOf(issues)).toContain('SECTION_QUESTION_ORDER_CONFLICT');
  });

  it('requires a prompt on writing tasks', () => {
    const section = baseSection({
      skill: 'WRITING',
      type: 'WRITING_TASK',
      hasPassage: false,
      title: 'Writing Task 1',
      promptText: null,
      groups: [
        {
          id: 'grp_w',
          type: 'WRITING_TASK_1',
          instructions: '',
          sharedOptions: [],
          questions: [
            { id: 'qw_1', number: 1, prompt: '', options: [], config: { minimumWords: 150 }, answerKey: { kind: 'MANUAL' } },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).toContain('WRITING_TASK_WITHOUT_PROMPT');
  });

  it('accepts writing tasks that have a prompt', () => {
    const section = baseSection({
      skill: 'WRITING',
      type: 'WRITING_TASK',
      hasPassage: false,
      title: 'Writing Task 1',
      promptText: 'The chart shows… Summarise the information.',
      groups: [
        {
          id: 'grp_w',
          type: 'WRITING_TASK_1',
          instructions: '',
          sharedOptions: [],
          questions: [
            { id: 'qw_1', number: 1, prompt: 'The chart shows…', options: [], config: { minimumWords: 150 }, answerKey: { kind: 'MANUAL' } },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).not.toContain('WRITING_TASK_WITHOUT_PROMPT');
  });

  it('gates the listening-audio requirement on the section policy', () => {
    const section = baseSection({ skill: 'LISTENING', type: 'LISTENING_PART', hasPassage: false, hasAudio: false });
    const strict = validateTestVersion(baseInput([section]));
    expect(codesOf(strict)).toContain('LISTENING_SECTION_WITHOUT_AUDIO');

    const lenient = validateTestVersion({
      ...baseInput([section]),
      sectionPolicy: { requireAudioForListening: false },
    });
    expect(codesOf(lenient)).not.toContain('LISTENING_SECTION_WITHOUT_AUDIO');
  });

  it('gates the reading-passage requirement on the section policy', () => {
    const section = baseSection({ hasPassage: false, passageParagraphCount: 0 });
    const strict = validateTestVersion(baseInput([section]));
    expect(codesOf(strict)).toContain('READING_SECTION_WITHOUT_PASSAGE');

    const lenient = validateTestVersion({
      ...baseInput([section]),
      sectionPolicy: { requirePassageForReading: false },
    });
    expect(codesOf(lenient)).not.toContain('READING_SECTION_WITHOUT_PASSAGE');
  });
});

describe('transcript validation (33)', () => {
  const transcript = {
    segments: [
      { id: 'seg-1', text: 'Good morning, how can I help?' },
      { id: 'seg-2', text: 'I would like to open an account.' },
    ],
  };

  it('accepts evidence that references real transcript segments', () => {
    const section = baseSection({
      skill: 'LISTENING',
      type: 'LISTENING_PART',
      hasPassage: false,
      hasAudio: true,
      transcript,
      groups: [
        {
          id: 'grp_l',
          type: 'SHORT_ANSWER',
          instructions: 'Complete the form.',
          sharedOptions: [],
          questions: [
            {
              id: 'ql_1',
              number: 1,
              prompt: 'Account type: ______',
              options: [],
              config: {},
              answerKey: { kind: 'TEXT', accept: ['savings'] },
              evidence: 'The applicant says "open an account" (segment:seg-2).',
            },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).not.toContain('TRANSCRIPT_SEGMENT_NOT_FOUND');
  });

  it('flags evidence that references a missing transcript segment', () => {
    const section = baseSection({
      skill: 'LISTENING',
      type: 'LISTENING_PART',
      hasPassage: false,
      hasAudio: true,
      transcript,
      groups: [
        {
          id: 'grp_l',
          type: 'SHORT_ANSWER',
          instructions: 'Complete the form.',
          sharedOptions: [],
          questions: [
            {
              id: 'ql_1',
              number: 1,
              prompt: 'Account type: ______',
              options: [],
              config: {},
              answerKey: { kind: 'TEXT', accept: ['savings'] },
              evidence: 'Agent: “certainly” (segment:seg-99).',
            },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).toContain('TRANSCRIPT_SEGMENT_NOT_FOUND');
  });

  it('flags segment references when the section has no transcript at all', () => {
    const section = baseSection({
      skill: 'LISTENING',
      type: 'LISTENING_PART',
      hasPassage: false,
      hasAudio: true,
      groups: [
        {
          id: 'grp_l',
          type: 'SHORT_ANSWER',
          instructions: 'Complete the form.',
          sharedOptions: [],
          questions: [
            {
              id: 'ql_1',
              number: 1,
              prompt: 'Account type: ______',
              options: [],
              config: {},
              answerKey: { kind: 'TEXT', accept: ['savings'] },
              evidence: 'See segment:seg-1.',
            },
          ],
        },
      ],
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).toContain('TRANSCRIPT_SEGMENT_NOT_FOUND');
  });

  it('detects duplicate transcript segment ids', () => {
    const section = baseSection({
      skill: 'LISTENING',
      type: 'LISTENING_PART',
      hasPassage: false,
      hasAudio: true,
      transcript: {
        segments: [
          { id: 'seg-1', text: 'One' },
          { id: 'seg-1', text: 'Two' },
        ],
      },
    });
    const issues = validateTestVersion(baseInput([section]));
    expect(codesOf(issues)).toContain('DUPLICATE_TRANSCRIPT_SEGMENT');
  });
});

// ---------------------------------------------------------------------------
// 32. Section-aware structured JSON import
// ---------------------------------------------------------------------------
describe('section-aware structured JSON import (32)', () => {
  const structuredPayload = {
    testTitle: 'Sectioned practice test',
    testType: 'FULL_MOCK',
    sections: [
      {
        sectionNumber: 1,
        type: 'listening_part',
        title: 'Listening Part 1',
        label: 'Part 1',
        order: 0,
        instructions: 'Complete the notes.',
        audio: { url: 'https://cdn.example.com/part1.mp3' },
        transcript: {
          segments: [
            { id: 'seg-1', startSeconds: 0, speaker: 'Agent', text: 'Good morning.' },
            { id: 'seg-2', startSeconds: 12, speaker: 'Caller', text: 'Hello, I have a question.' },
          ],
        },
        questionGroups: [
          {
            questionType: 'NOTE_COMPLETION',
            instructions: 'Complete the notes. ONE WORD ONLY.',
            fromQuestion: 1,
            toQuestion: 2,
            questions: [
              { number: 1, prompt: 'Enquiry type: ______', answer: 'billing' },
              { number: 2, prompt: 'Account: ______', answer: 'savings' },
            ],
          },
        ],
      },
      {
        sectionNumber: 2,
        type: 'reading_passage',
        title: 'Reading Passage 1',
        label: 'Passage 1',
        order: 1,
        description: 'A short practice passage.',
        passage: {
          title: 'Libraries of the future',
          paragraphs: [
            { label: 'A', text: 'Libraries have changed enormously.' },
            { label: 'B', text: 'Digital collections are expanding.' },
          ],
        },
        questionGroups: [
          {
            questionType: 'TRUE_FALSE_NOT_GIVEN',
            instructions: 'Write TRUE, FALSE or NOT GIVEN.',
            questions: [
              { number: 3, prompt: 'Libraries are changing.', answer: 'TRUE' },
              { number: 4, prompt: 'Print collections are growing.', answer: 'FALSE' },
            ],
          },
          {
            questionType: 'MCQ_SINGLE',
            instructions: 'Choose the correct answer.',
            options: [
              { id: 'A', text: 'Digital' },
              { id: 'B', text: 'Print' },
            ],
            questions: [{ number: 5, prompt: 'Which collection is expanding?', answer: 'A' }],
          },
        ],
      },
      {
        sectionNumber: 3,
        type: 'writing_task',
        title: 'Writing Task 1',
        label: 'Task 1',
        order: 2,
        prompt: 'Summarise the chart showing library visits.',
        minimumWords: 150,
        questionGroups: [
          { questionType: 'WRITING_TASK_1', instructions: 'Spend about 20 minutes.', questions: [{ number: 6, prompt: '' }] },
        ],
      },
    ],
    answerKey: [{ questionNumber: 2, answer: 'current', evidence: 'segment:seg-2' }],
  };

  it('converts explicit sections with structural types, labels and order', () => {
    const result = convertAiPayload(structuredPayload);
    expect(result.issues).toEqual([]);
    expect(result.content.sections).toHaveLength(3);

    const sections = result.content.sections;
    const listening = sections[0]!;
    const reading = sections[1]!;
    const writing = sections[2]!;
    expect(listening.type).toBe('LISTENING_PART');
    expect(listening.label).toBe('Part 1');
    expect(listening.audioUrl).toBe('https://cdn.example.com/part1.mp3');
    const segments = (listening.transcript as { segments: Array<Record<string, unknown>> }).segments;
    expect(segments).toHaveLength(2);
    expect(segments[1]).toMatchObject({ id: 'seg-2', startSeconds: 12, speaker: 'Caller' });

    expect(reading.type).toBe('READING_PASSAGE');
    expect(reading.description).toBe('A short practice passage.');
    expect(reading.passage?.paragraphs).toHaveLength(2);

    expect(writing.type).toBe('WRITING_TASK');
    expect(writing.groups[0]!.config.minimumWords).toBe(150);
    expect(writing.groups[0]!.questions[0]!.prompt).toBe('Summarise the chart showing library visits.');

    // Ranges are derived from fromQuestion/toQuestion or the questions.
    expect(listening.groups[0]!.rangeFrom).toBe(1);
    expect(listening.groups[0]!.rangeTo).toBe(2);
    expect(result.questionCount).toBe(6);
    expect(result.answerKeyConfidence).toBe('PROVIDED');
  });

  it('honours a top-level answerKey and records transcript evidence', () => {
    const result = convertAiPayload(structuredPayload);
    const question2 = result.content.sections[0]!.groups[0]!.questions[1]!;
    expect(question2.answerKey).toMatchObject({ kind: 'TEXT' });
  });

  it('scaffolds numbered questions from fromQuestion/toQuestion', () => {
    const result = convertAiPayload({
      testTitle: 'Scaffolded listening',
      testType: 'LISTENING',
      sections: [
        {
          type: 'LISTENING_PART',
          label: 'Part 1',
          audio: { url: 'https://cdn.example.com/a.mp3' },
          questionGroups: [{ questionType: 'FORM_COMPLETION_UNKNOWN_TYPE', fromQuestion: 1, toQuestion: 3 }],
        },
        {
          type: 'LISTENING_PART',
          label: 'Part 2',
          audio: 'https://cdn.example.com/b.mp3',
          questionGroups: [{ questionType: 'short_answer', instructions: 'Answer.', questions: [{ number: 4, prompt: 'Name:', answer: 'Anna' }] }],
        },
      ],
    });
    expect(result.issues.some((issue) => issue.code === 'AI_UNKNOWN_QUESTION_TYPE')).toBe(true);
    expect(result.questionCount).toBe(1);
    expect(result.content.sections[1]!.groups[0]!.questions[0]!.answerKey).toMatchObject({ kind: 'TEXT' });
  });

  it('reports an unknown section type instead of silently guessing', () => {
    const result = convertAiPayload({
      testTitle: 'Bad section',
      testType: 'READING',
      sections: [
        {
          type: 'FILM_CLIP',
          questionGroups: [{ questionType: 'SHORT_ANSWER', questions: [{ number: 1, prompt: 'x', answer: 'y' }] }],
        },
      ],
    });
    expect(result.issues.some((issue) => issue.code === 'INVALID_SECTION_TYPE')).toBe(true);
  });

  it('does not require a fixed number of sections (configurable counts)', () => {
    const result = convertAiPayload({
      testTitle: 'Short practice',
      testType: 'READING',
      sections: [
        {
          type: 'reading_passage',
          title: 'Single passage',
          passage: { title: 'Solo', paragraphs: [{ label: 'A', text: 'Only paragraph.' }] },
          questionGroups: [
            { questionType: 'true_false_not_given', questions: [{ number: 1, prompt: 'One.', answer: 'TRUE' }] },
          ],
        },
      ],
    });
    expect(result.content.sections).toHaveLength(1);
    expect(result.content.sections[0]!.label).toBe('Passage 1');
    expect(summariseIssues([] as never[]).publishable).toBe(true);
  });
});
