import { describe, expect, it } from 'vitest';
import { countWords, validateTestVersion, type ValidationInput } from '../../src/shared/validation';

/**
 * Import hardening.
 *
 * A structured Reading import can arrive from a file, a paste box or an AI
 * provider. These tests pin the deterministic checks that stop a broken or
 * answer-leaking import from reaching a candidate, and that keep a declared
 * word count from overriding the text itself.
 */
const PARAGRAPH_A =
  'Urban planners in the late twentieth century favoured the private car, and whole districts were rebuilt around it.';
const PARAGRAPH_B =
  'By 2015 the same planners were being asked to undo that decision, which proved far harder than making it had been.';

function baseInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    testType: 'READING',
    title: 'Imported reading set',
    sections: [
      {
        id: 'sec_1',
        skill: 'READING',
        orderIndex: 0,
        title: 'Passage 1',
        instructions: 'Answer the questions.',
        hasPassage: true,
        passageParagraphCount: 2,
        passage: {
          paragraphs: [
            { label: 'A', text: PARAGRAPH_A },
            { label: 'B', text: PARAGRAPH_B },
          ],
        },
        hasAudio: false,
        groups: [
          {
            id: 'grp_1',
            type: 'TRUE_FALSE_NOT_GIVEN',
            instructions: 'Write TRUE, FALSE or NOT GIVEN.',
            sharedOptions: [],
            rangeFrom: 1,
            rangeTo: 1,
            questions: [
              {
                id: 'q_1',
                number: 1,
                prompt: 'Planners once designed districts around cars.',
                options: [],
                config: {},
                answerKey: { kind: 'CHOICE', values: ['TRUE'] },
              },
            ],
          },
        ],
        ...overrides.sections?.[0],
      },
    ],
    ...overrides,
  };
}

function codes(input: ValidationInput): string[] {
  return validateTestVersion(input).map((issue) => issue.code);
}

describe('imported passage structure', () => {
  it('rejects duplicate paragraph labels', () => {
    const input = baseInput();
    input.sections[0]!.passage!.paragraphs = [
      { label: 'A', text: PARAGRAPH_A },
      { label: 'A', text: PARAGRAPH_B },
    ];
    expect(codes(input)).toContain('DUPLICATE_PARAGRAPH_LABEL');
  });

  it('rejects paragraph text that is repeated verbatim', () => {
    const input = baseInput();
    input.sections[0]!.passage!.paragraphs = [
      { label: 'A', text: PARAGRAPH_A },
      { label: 'B', text: `${PARAGRAPH_A} ` },
    ];
    expect(codes(input)).toContain('DUPLICATE_PARAGRAPH_TEXT');
  });

  it('warns when the declared word count disagrees with the text', () => {
    const input = baseInput();
    input.sections[0]!.passage!.declaredWordCount = 500;
    const issues = validateTestVersion(input);
    const mismatch = issues.find((issue) => issue.code === 'PASSAGE_WORD_COUNT_MISMATCH');
    expect(mismatch?.level).toBe('WARNING');
    expect(mismatch?.message).toContain(String(countWords(`${PARAGRAPH_A} ${PARAGRAPH_B}`)));
  });

  it('accepts a declared word count that matches the text', () => {
    const input = baseInput();
    input.sections[0]!.passage!.declaredWordCount = countWords(`${PARAGRAPH_A} ${PARAGRAPH_B}`);
    expect(codes(input)).not.toContain('PASSAGE_WORD_COUNT_MISMATCH');
  });

  it('counts words deterministically', () => {
    expect(countWords('  one two   three ')).toBe(3);
    expect(countWords('— …')).toBe(0);
  });

  it('flags an empty paragraph and a missing label', () => {
    const input = baseInput();
    input.sections[0]!.passage!.paragraphs = [
      { label: 'A', text: PARAGRAPH_A },
      { label: '', text: '   ' },
    ];
    const found = codes(input);
    expect(found).toContain('EMPTY_PARAGRAPH');
  });
});

describe('student-visible content must not carry answers', () => {
  it('rejects an answer field nested in a question prompt', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.prompt =
      'Planners designed districts around cars. {"answer": "TRUE"}';
    const issues = validateTestVersion(input);
    const leak = issues.find((issue) => issue.code === 'LEAKED_ANSWER_FIELD');
    expect(leak?.level).toBe('ERROR');
    expect(leak?.questionNumber).toBe(1);
  });

  it('scans shared option banks and group instructions', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.instructions = 'Choose the heading. correctAnswer: iv';
    expect(codes(input)).toContain('LEAKED_ANSWER_FIELD');
  });

  it('leaves ordinary prose alone', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.prompt =
      'The passage says the decision was hard to undo. Which word describes it?';
    expect(codes(input)).not.toContain('LEAKED_ANSWER_FIELD');
  });
});

describe('marking evidence', () => {
  it('rejects evidence that does not quote the passage', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.evidence = '“This sentence is not in the passage at all.”';
    const issues = validateTestVersion(input);
    expect(issues.find((issue) => issue.code === 'EVIDENCE_QUOTE_NOT_FOUND')?.level).toBe('ERROR');
  });

  it('accepts a verbatim quote, ignoring case and whitespace', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.evidence =
      '“urban   planners in the late twentieth century favoured the private car”';
    expect(codes(input)).not.toContain('EVIDENCE_QUOTE_NOT_FOUND');
  });

  it('does not demand a verbatim match for free-form marking notes', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.evidence =
      'Marking note: accept the paraphrase; the candidate must name the council.';
    expect(codes(input)).not.toContain('EVIDENCE_QUOTE_NOT_FOUND');
  });

  it('rejects raw JSON stored as evidence', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.evidence = '{"quote": "anything"}';
    expect(codes(input)).toContain('MALFORMED_EVIDENCE');
  });
});

describe('ranges, limits and keys', () => {
  it('rejects a malformed declared range', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.rangeFrom = 5;
    input.sections[0]!.groups[0]!.rangeTo = 2;
    expect(codes(input)).toContain('MALFORMED_RANGE');
  });

  it('warns about overlapping groups', () => {
    const input = baseInput();
    input.sections[0]!.groups = [
      { ...input.sections[0]!.groups[0]!, id: 'grp_1', rangeFrom: 1, rangeTo: 4 },
      {
        id: 'grp_2',
        type: 'TRUE_FALSE_NOT_GIVEN',
        instructions: 'Write TRUE, FALSE or NOT GIVEN.',
        sharedOptions: [],
        rangeFrom: 3,
        rangeTo: 5,
        questions: [
          {
            id: 'q_5',
            number: 5,
            prompt: 'A second statement.',
            options: [],
            config: {},
            answerKey: { kind: 'CHOICE', values: ['FALSE'] },
          },
        ],
      },
    ];
    const issues = validateTestVersion(input);
    expect(issues.find((issue) => issue.code === 'OVERLAPPING_RANGE')?.level).toBe('WARNING');
  });

  it('rejects an impossible word limit', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.config = { wordLimit: { min: 5, max: 2 } };
    expect(codes(input)).toContain('INVALID_WORD_LIMIT');
  });

  it('rejects an answer key that references an option which does not exist', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.type = 'MCQ_SINGLE';
    input.sections[0]!.groups[0]!.questions[0]!.options = [
      { id: 'A', text: 'first' },
      { id: 'B', text: 'second' },
    ];
    input.sections[0]!.groups[0]!.questions[0]!.answerKey = { kind: 'CHOICE', values: ['D'] };
    expect(codes(input)).toContain('INVALID_ANSWER_VALUE');
  });

  it('still reports a missing answer key without blocking the draft', () => {
    const input = baseInput();
    input.sections[0]!.groups[0]!.questions[0]!.answerKey = null;
    const issues = validateTestVersion(input);
    expect(issues.find((issue) => issue.code === 'MISSING_ANSWER_KEY')?.level).toBe('WARNING');
  });
});
