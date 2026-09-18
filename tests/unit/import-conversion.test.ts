import { describe, expect, it } from 'vitest';
import { convertAiPayload } from '../../src/worker/services/import-service';
import { sanitiseIntegrityOverrides } from '../../src/worker/services/teacher-service';
import { parseValue } from '../../src/worker/lib/settings';

const basePayload = {
  testTitle: 'Coastal Weather Systems',
  testType: 'READING',
  answerKeyConfidence: 'PROVIDED',
  warnings: [],
  passages: [
    {
      title: 'Coastal Weather',
      paragraphs: [
        { label: 'A', text: 'First paragraph.' },
        { label: 'B', text: 'Second paragraph.' },
      ],
    },
  ],
  sections: [
    {
      skill: 'READING',
      title: 'Passage 1',
      instructions: 'Answer the questions.',
      passageIndex: 0,
      audioProvided: false,
      groups: [
        {
          questionType: 'TRUE_FALSE_NOT_GIVEN',
          instructions: 'Write TRUE, FALSE or NOT GIVEN.',
          sharedOptions: [],
          selectCount: null,
          wordLimitMax: null,
          questions: [
            { number: 1, prompt: 'Storms form offshore.', options: [], answer: 'TRUE', evidence: 'paragraph A', explanation: null },
            { number: 2, prompt: 'Rainfall is constant.', options: [], answer: 'FALSE', evidence: null, explanation: null },
          ],
        },
      ],
    },
  ],
};


/** Test helper: mutate one question's answer without widening the fixture type. */
function setAnswer(payload: typeof basePayload, questionIndex: number, answer: string | null): void {
  const group = payload.sections[0]!.groups[0] as unknown as { questions: Array<{ answer: string | null }> };
  group.questions[questionIndex]!.answer = answer;
}

describe('convertAiPayload — deterministic conversion of AI output', () => {
  it('converts a well-formed payload into editable content with keys from the source', () => {
    const result = convertAiPayload(basePayload);
    expect(result.content.sections).toHaveLength(1);
    expect(result.questionCount).toBe(2);
    const question = result.content.sections[0]!.groups[0]!.questions[0]!;
    expect(question.number).toBe(1);
    expect(question.prompt).toBe('Storms form offshore.');
    expect(question.answerKey).toEqual({ kind: 'CHOICE', values: ['TRUE'] });
    expect(question.evidence).toBe('paragraph A');
    expect(result.content.sections[0]!.passage?.paragraphs).toHaveLength(2);
  });

  it('rejects a payload that does not match the schema instead of guessing', () => {
    const result = convertAiPayload({ nonsense: true });
    expect(result.content.sections).toHaveLength(0);
    expect(result.answerKeyConfidence).toBe('ABSENT');
    expect(result.issues.every((issue) => issue.level === 'ERROR')).toBe(true);
    expect(result.issues[0]!.code).toBe('AI_PAYLOAD_SCHEMA');
  });

  it('does not fabricate an answer key when the source has none', () => {
    const payload = structuredClone(basePayload);
    setAnswer(payload, 0, null);
    setAnswer(payload, 1, null);
    const result = convertAiPayload(payload);
    for (const question of result.content.sections[0]!.groups[0]!.questions) {
      expect(question.answerKey ?? null).toBeNull();
    }
    expect(result.answerKeyConfidence).toBe('ABSENT');
    expect(result.issues.some((issue) => issue.message.toLowerCase().includes('answer key'))).toBe(true);
  });

  it('warns about a partial key rather than filling the gaps', () => {
    const payload = structuredClone(basePayload);
    setAnswer(payload, 1, null);
    const result = convertAiPayload(payload);
    expect(result.answerKeyConfidence).toBe('PARTIAL');
    expect(result.content.sections[0]!.groups[0]!.questions[1]!.answerKey ?? null).toBeNull();
    expect(result.content.sections[0]!.groups[0]!.questions[0]!.answerKey).toEqual({ kind: 'CHOICE', values: ['TRUE'] });
    expect(result.issues.some((issue) => issue.code === 'AI_PARTIAL_ANSWER_KEY')).toBe(true);
  });

  it('flags a passage reference that the model did not return', () => {
    const payload = structuredClone(basePayload);
    (payload.sections[0] as unknown as { passageIndex: number | null }).passageIndex = 7;
    const result = convertAiPayload(payload);
    expect(result.issues.some((issue) => issue.code === 'AI_MISSING_PASSAGE_REFERENCE')).toBe(true);
  });

  it('carries model warnings through as WARNING issues', () => {
    const payload = structuredClone(basePayload);
    (payload as unknown as { warnings: string[] }).warnings = ['Page 3 was not readable.'];
    const result = convertAiPayload(payload);
    expect(result.issues.some((issue) => issue.level === 'WARNING' && issue.message.includes('Page 3'))).toBe(true);
  });

  it('treats an unknown question type as an explicit issue and drops the group', () => {
    const payload = structuredClone(basePayload);
    (payload.sections[0]!.groups[0] as unknown as { questionType: string }).questionType = 'TELEPATHY';
    const result = convertAiPayload(payload);
    expect(result.content.sections[0]!.groups).toHaveLength(0);
    expect(result.issues.some((issue) => issue.code === 'AI_UNKNOWN_QUESTION_TYPE')).toBe(true);
    expect(result.questionCount).toBe(0);
  });
});

describe('sanitiseIntegrityOverrides — the server whitelists policy overrides', () => {
  it('accepts only known keys with sane types', () => {
    const sanitised = sanitiseIntegrityOverrides({
      maxTabAwayEvents: 3,
      monitorVisibility: false,
      allowPaste: true,
      evilKey: 'drop table',
      autoSubmitAtEvents: null,
    });
    expect(sanitised).toEqual({
      maxTabAwayEvents: 3,
      monitorVisibility: false,
      allowPaste: true,
      autoSubmitAtEvents: null,
    });
    expect('evilKey' in sanitised).toBe(false);
  });

  it('clamps numbers and drops strings, objects and NaN', () => {
    const sanitised = sanitiseIntegrityOverrides({
      maxTabAwayEvents: 9999,
      maxFullscreenExits: -4,
      warnAtEvents: Number.NaN,
      monitorVisibility: 'yes',
      requireFullscreen: { nested: true },
    });
    expect(sanitised.maxTabAwayEvents).toBe(100);
    expect(sanitised.maxFullscreenExits).toBe(0);
    expect('warnAtEvents' in sanitised).toBe(false);
    expect('monitorVisibility' in sanitised).toBe(false);
    expect('requireFullscreen' in sanitised).toBe(false);
  });

  it('returns an empty object for non-objects', () => {
    expect(sanitiseIntegrityOverrides(null)).toEqual({});
    expect(sanitiseIntegrityOverrides('maxTabAwayEvents: 1')).toEqual({});
  });
});

describe('platform settings parsing', () => {
  it('parses JSON values and tolerates corrupt rows', () => {
    expect(parseValue('true')).toBe(true);
    expect(parseValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseValue('not json')).toBeNull();
  });
});
