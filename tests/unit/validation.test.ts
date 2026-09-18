import { describe, expect, it } from 'vitest';
import {
  summariseIssues,
  validateTestVersion,
  type ValidationInput,
  type ValidationSection,
} from '../../src/shared/validation';

function readingSection(overrides: Partial<ValidationSection> = {}): ValidationSection {
  return {
    id: 'sec_1',
    skill: 'READING',
    orderIndex: 0,
    title: 'Passage 1',
    instructions: 'Read the passage and answer the questions.',
    hasPassage: true,
    passageParagraphCount: 3,
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
          {
            id: 'q_1',
            number: 1,
            prompt: 'The city opened its first library in 1901.',
            options: [],
            config: {},
            answerKey: { kind: 'CHOICE', values: ['TRUE'] },
          },
          {
            id: 'q_2',
            number: 2,
            prompt: 'Membership is free for residents.',
            options: [],
            config: {},
            answerKey: { kind: 'CHOICE', values: ['FALSE'] },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    testType: 'READING',
    title: 'Libraries of the North',
    sections: [readingSection()],
    ...overrides,
  };
}

function codes(issues: ReturnType<typeof validateTestVersion>): string[] {
  return issues.map((issue) => issue.code);
}

describe('validateTestVersion — publish gate', () => {
  it('accepts a well-formed reading version without errors', () => {
    const issues = validateTestVersion(input());
    const summary = summariseIssues(issues);
    expect(summary.errors).toBe(0);
    expect(summary.publishable).toBe(true);
  });

  it('requires a title and at least one section', () => {
    expect(codes(validateTestVersion(input({ title: 'x' })))).toContain('MISSING_TEST_TITLE');
    expect(codes(validateTestVersion(input({ sections: [] })))).toContain('NO_SECTIONS');
  });

  it('blocks a reading section without a passage', () => {
    const issues = validateTestVersion(input({ sections: [readingSection({ hasPassage: false, passageParagraphCount: 0 })] }));
    expect(codes(issues)).toContain('READING_SECTION_WITHOUT_PASSAGE');
    expect(summariseIssues(issues).publishable).toBe(false);
  });

  it('blocks a listening section without audio', () => {
    const section = readingSection({ skill: 'LISTENING', hasPassage: false, passageParagraphCount: 0, hasAudio: false });
    section.groups[0]!.type = 'MCQ_SINGLE';
    const issues = validateTestVersion(input({ testType: 'LISTENING', sections: [section] }));
    expect(codes(issues)).toContain('LISTENING_SECTION_WITHOUT_AUDIO');
  });

  it('blocks a full mock without components', () => {
    const issues = validateTestVersion(input({ testType: 'FULL_MOCK', mockComponentIssues: undefined }));
    expect(codes(issues)).not.toContain('MOCK_WITHOUT_COMPONENTS');
    const withMockIssue = validateTestVersion(
      input({
        testType: 'FULL_MOCK',
        mockComponentIssues: [
          { level: 'ERROR', code: 'MOCK_WITHOUT_COMPONENTS', message: 'A full mock needs components.' },
        ],
      }),
    );
    expect(codes(withMockIssue)).toContain('MOCK_WITHOUT_COMPONENTS');
  });

  it('blocks duplicate question numbers', () => {
    const section = readingSection();
    section.groups[0]!.questions[1]!.number = 1;
    const issues = validateTestVersion(input({ sections: [section] }));
    expect(codes(issues)).toContain('DUPLICATE_QUESTION_NUMBER');
    expect(summariseIssues(issues).publishable).toBe(false);
  });

  it('blocks MCQ questions without options', () => {
    const section = readingSection();
    section.groups[0]!.type = 'MCQ_SINGLE';
    section.groups[0]!.questions[0]!.options = [{ id: 'A', text: 'Option A' }];
    section.groups[0]!.questions[1]!.options = [];
    section.groups[0]!.questions[0]!.answerKey = { kind: 'CHOICE', values: ['A'] };
    const issues = validateTestVersion(input({ sections: [section] }));
    expect(codes(issues)).toContain('MCQ_WITHOUT_OPTIONS');
  });

  it('blocks a question without prompt text', () => {
    const section = readingSection();
    section.groups[0]!.questions[1]!.prompt = '   ';
    expect(codes(validateTestVersion(input({ sections: [section] })))).toContain('QUESTION_WITHOUT_PROMPT');
  });

  it('warns — but does not block — when a key is absent, instead of inventing one', () => {
    const section = readingSection();
    section.groups[0]!.questions[1]!.answerKey = null;
    const issues = validateTestVersion(input({ sections: [section] }));
    const keyIssue = issues.find((issue) => issue.code === 'MISSING_ANSWER_KEY');
    expect(keyIssue?.level).toBe('WARNING');
    expect(summariseIssues(issues).publishable).toBe(true);
  });

  it('flags an answer key value that is not one of the offered options', () => {
    const section = readingSection();
    section.groups[0]!.type = 'MCQ_SINGLE';
    section.groups[0]!.questions[0]!.options = [{ id: 'A', text: 'first' }];
    section.groups[0]!.questions[0]!.answerKey = { kind: 'CHOICE', values: ['Z'] };
    section.groups[0]!.questions[1]!.options = [{ id: 'A', text: 'first' }];
    section.groups[0]!.questions[1]!.answerKey = { kind: 'CHOICE', values: ['A'] };
    expect(codes(validateTestVersion(input({ sections: [section] })))).toContain('ANSWER_NOT_AMONG_OPTIONS');
  });

  it('flags a question type used in the wrong skill', () => {
    const section = readingSection();
    section.groups[0]!.type = 'WRITING_TASK_1';
    expect(codes(validateTestVersion(input({ sections: [section] })))).toContain('QUESTION_TYPE_SKILL_MISMATCH');
  });

  it('flags a multi-select group without a select count or duplicated options', () => {
    const section = readingSection();
    section.groups[0]!.type = 'MCQ_MULTI';
    section.groups[0]!.questions = [
      {
        id: 'q_1',
        number: 1,
        prompt: 'Choose two.',
        options: [
          { id: 'A', text: 'alpha' },
          { id: 'A', text: 'beta' },
        ],
        config: {},
        answerKey: { kind: 'CHOICE', values: ['A'] },
      },
    ];
    const issueCodes = codes(validateTestVersion(input({ sections: [section] })));
    expect(issueCodes).toContain('DUPLICATE_MCQ_OPTION');
    expect(issueCodes).toContain('MCQ_MULTI_WITHOUT_SELECT_COUNT');
  });
});

describe('summariseIssues', () => {
  it('treats any error as unpublishable', () => {
    expect(summariseIssues([{ level: 'ERROR', code: 'X', message: 'x' }]).publishable).toBe(false);
    expect(summariseIssues([{ level: 'WARNING', code: 'X', message: 'x' }])).toMatchObject({
      errors: 0,
      warnings: 1,
      publishable: true,
    });
    expect(summariseIssues([])).toMatchObject({ errors: 0, warnings: 0, publishable: true });
  });
});
