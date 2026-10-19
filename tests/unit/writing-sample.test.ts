import { describe, expect, it } from 'vitest';
import {
  convertAiPayload,
  inferTestType,
  type EditableSection,
} from '../../src/shared/import-convert';
import { validateTestVersion, type ValidationInput } from '../../src/shared/validation';

import payload from '../../docs/samples/writing-60-minute-set.json';

/**
 * The sample file is shipped for admins to upload through the import flow, so
 * this suite runs the same conversion the importer runs and then asserts that
 * the platform's own validator accepts the result. Writing tasks carry no
 * answer key (they are teacher/AI-marked), so ABSENT confidence is the correct
 * outcome, not a missing-key warning.
 */
describe('docs/samples/writing-60-minute-set.json', () => {
  const conversion = convertAiPayload(payload);

  /** Mirrors the parts of content-service.toValidationInput() the sample can exercise. */
  function toValidationInput(sections: EditableSection[]): ValidationInput {
    return {
      testType: 'WRITING',
      title: payload.testTitle,
      sections: sections.map((section, index) => ({
        id: `section-${index}`,
        skill: section.skill,
        orderIndex: index,
        type: section.type ?? 'WRITING_TASK',
        label: section.label ?? null,
        title: section.title,
        instructions: section.instructions,
        hasPassage: false,
        passageParagraphCount: 0,
        passage: null,
        hasAudio: false,
        promptText: [
          section.instructions,
          ...section.groups.flatMap((group) => group.questions.map((question) => question.prompt)),
        ]
          .filter(Boolean)
          .join('\n'),
        minimumWords:
          section.groups
            .map((group) => group.config.minimumWords)
            .find((value) => typeof value === 'number' && value > 0) ?? null,
        groups: section.groups.map((group, groupIndex) => ({
          id: `group-${index}-${groupIndex}`,
          type: group.type,
          instructions: group.instructions,
          sharedOptions: group.sharedOptions,
          rangeFrom: group.rangeFrom ?? null,
          rangeTo: group.rangeTo ?? null,
          bodyTexts: [],
          questions: group.questions.map((question, questionIndex) => ({
            id: `question-${index}-${groupIndex}-${questionIndex}`,
            number: question.number,
            prompt: question.prompt,
            bodyText: null,
            evidence: question.evidence ?? null,
            options: question.options,
            config: question.config,
            answerKey: question.answerKey ?? null,
          })),
        })),
      })),
    } as ValidationInput;
  }

  it('converts without errors into two writing sections', () => {
    expect(conversion.issues.filter((issue) => issue.level === 'ERROR')).toEqual([]);
    expect(inferTestType(conversion.content)).toBe('WRITING');
    expect(conversion.content.sections).toHaveLength(2);
    expect(conversion.questionCount).toBe(2);
    // Essays have no auto key; the importer must not flag that as missing.
    expect(conversion.answerKeyConfidence).toBe('ABSENT');
    expect(conversion.content.durationSeconds).toBe(3600);
    expect(conversion.content.isCompleteTest).toBe(true);
  });

  it('keeps the task minimums, section timings and question numbers', () => {
    const [first, second] = conversion.content.sections;
    expect(first?.skill).toBe('WRITING');
    expect(first?.durationSeconds).toBe(1200);
    expect(first?.groups).toHaveLength(1);
    expect(first?.groups[0]?.type).toBe('WRITING_TASK_1');
    expect(first?.groups[0]?.config.minimumWords).toBe(150);
    expect(first?.groups[0]?.questions[0]?.number).toBe(1);
    expect(first?.groups[0]?.questions[0]?.prompt.length).toBeGreaterThan(80);

    expect(second?.durationSeconds).toBe(2400);
    expect(second?.groups[0]?.type).toBe('WRITING_TASK_2');
    expect(second?.groups[0]?.config.minimumWords).toBe(250);
    expect(second?.groups[0]?.questions[0]?.number).toBe(2);
    expect(second?.groups[0]?.questions[0]?.prompt.length).toBeGreaterThan(80);

    // Teacher-marked: no answer key may be invented for either essay.
    expect(first?.groups[0]?.questions[0]?.answerKey).toBeFalsy();
    expect(second?.groups[0]?.questions[0]?.answerKey).toBeFalsy();
  });

  it('passes the platform validator (writing prompt + minimum words)', () => {
    const issues = validateTestVersion(toValidationInput(conversion.content.sections));
    expect(issues.filter((issue) => issue.level === 'ERROR')).toEqual([]);
  });
});
