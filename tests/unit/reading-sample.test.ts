import { describe, expect, it } from 'vitest';
import { convertAiPayload } from '../../src/shared/import-convert';
import type { EditableQuestion, EditableSection } from '../../src/shared/import-convert';
import { validateTestVersion, type ValidationInput } from '../../src/shared/validation';

import payload from '../../docs/samples/reading-four-passages.json';

/**
 * The sample file is shipped for admins to upload through the import flow, so
 * this suite runs the same conversion the importer runs and then asserts that
 * the platform's own validator accepts the result. If the validator's evidence
 * rules change, this test fails before a broken sample can be published.
 */
describe('docs/samples/reading-four-passages.json', () => {
  const conversion = convertAiPayload(payload);

  /** Mirrors the parts of content-service.toValidationInput() the sample can exercise. */
  function toValidationInput(sections: EditableSection[]): ValidationInput {
    return {
      testType: 'READING',
      title: payload.testTitle,
      sections: sections.map((section, index) => ({
        id: `section-${index}`,
        skill: section.skill,
        orderIndex: index,
        type: section.type ?? 'READING_PASSAGE',
        label: section.label ?? null,
        title: section.title,
        instructions: section.instructions,
        hasPassage: Boolean(section.passage && section.passage.paragraphs.length > 0),
        passageParagraphCount: section.passage?.paragraphs.length ?? 0,
        passage: section.passage
          ? {
              paragraphs: section.passage.paragraphs.map((paragraph) => ({
                label: paragraph.label ?? '',
                text: paragraph.text ?? '',
              })),
              declaredWordCount: section.passage.passageWordCount ?? null,
            }
          : null,
        hasAudio: Boolean(section.audioAssetId),
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

  it('converts into four reading sections with 40 numbered questions', () => {
    expect(conversion.content.sections).toHaveLength(4);
    expect(conversion.questionCount).toBe(40);

    const numbers = conversion.content.sections.flatMap((section) =>
      section.groups.flatMap((group) => group.questions.map((question) => question.number)),
    );
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });

  /** Both key shapes (option ids and accepted wordings) count as an answer. */
  function acceptedAnswers(key: EditableQuestion['answerKey']): string[] {
    if (!key || key.kind === 'MANUAL') return [];
    return key.kind === 'CHOICE' ? key.values : key.accept;
  }

  it('gives every question an answer key, evidence and explanation', () => {
    for (const section of conversion.content.sections) {
      for (const group of section.groups) {
        for (const question of group.questions) {
          expect(question.answerKey, `Q${question.number} answer key`).not.toBeNull();
          expect(acceptedAnswers(question.answerKey).length, `Q${question.number} key values`).toBeGreaterThan(0);
          expect((question.evidence ?? '').length, `Q${question.number} evidence`).toBeGreaterThan(20);
          expect((question.explanation ?? '').length, `Q${question.number} explanation`).toBeGreaterThan(20);
        }
      }
    }
  });

  it('passes the platform validator with no errors', () => {
    const issues = validateTestVersion(toValidationInput(conversion.content.sections));
    const errors = issues.filter((issue) => issue.level === 'ERROR');
    expect(errors.map((issue) => `${issue.code}: ${issue.message}`)).toEqual([]);
  });

  it('quotes every piece of evidence verbatim from the passage it belongs to', () => {
    const normalise = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

    conversion.content.sections.forEach((section, sectionIndex) => {
      const haystack = normalise(
        (section.passage?.paragraphs ?? []).map((paragraph) => paragraph.text).join(' '),
      );
      expect(haystack.length, `Passage ${sectionIndex + 1} has text`).toBeGreaterThan(500);

      for (const group of section.groups) {
        for (const question of group.questions) {
          const quotes = [...(question.evidence ?? '').matchAll(/[“"]([^“”"]{12,})[”"]/g)].map((match) => match[1]!);
          expect(quotes.length, `Q${question.number} quotes passage text`).toBeGreaterThan(0);
          for (const quote of quotes) {
            expect(
              haystack.includes(normalise(quote)),
              `Q${question.number}: “${quote.slice(0, 60)}…” is not in Passage ${sectionIndex + 1}`,
            ).toBe(true);
          }
        }
      }
    });
  });

  it('keeps completion answers inside the stated word limit', () => {
    for (const section of conversion.content.sections) {
      for (const group of section.groups) {
        if (!group.type.endsWith('COMPLETION')) continue;
        const limit = group.config.wordLimit?.max ?? null;
        expect(limit, `${group.type} states a word limit`).not.toBeNull();
        for (const question of group.questions) {
          for (const value of acceptedAnswers(question.answerKey)) {
            expect(
              value.trim().split(/\s+/).length,
              `Q${question.number} answer “${value}” exceeds the ${limit}-word limit`,
            ).toBeLessThanOrEqual(limit ?? 99);
          }
        }
      }
    }
  });
});
