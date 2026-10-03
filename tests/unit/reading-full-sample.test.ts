import { describe, expect, it } from 'vitest';
import { convertAiPayload, parseIntoEditableContent } from '../../src/shared/import-convert';
import type { EditableQuestion, EditableSection } from '../../src/shared/import-convert';
import { summariseIssues, validateTestVersion, type ValidationInput } from '../../src/shared/validation';

import payload from '../../docs/samples/reading-three-passages.json';

/**
 * `docs/samples/reading-three-passages.json` is a complete 40-question Academic
 * Reading paper (three passages, 60 minutes) in the sectioned import format
 * documented in `docs/QUESTION-AUTHORING.md` §2. It ships for administrators to
 * paste into Admin → Imports, so this suite runs the same conversion the
 * importer runs and then applies the platform's own validator: a sample that
 * would fail on Apply must fail here first.
 */
describe('docs/samples/reading-three-passages.json', () => {
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

  const issues = validateTestVersion(toValidationInput(conversion.content.sections));

  it('converts into three reading sections with 40 numbered questions', () => {
    expect(conversion.content.sections).toHaveLength(3);
    expect(conversion.content.sections.every((section) => section.skill === 'READING')).toBe(true);
    expect(conversion.questionCount).toBe(40);
    expect(conversion.answerKeyConfidence).toBe('PROVIDED');

    const numbers = conversion.content.sections.flatMap((section) =>
      section.groups.flatMap((group) => group.questions.map((question) => question.number)),
    );
    expect(numbers).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
  });

  it('keeps the declared one-hour duration and the passage titles', () => {
    expect(conversion.content.durationSeconds).toBe(3600);
    expect(conversion.content.sections.map((section) => section.title)).toEqual([
      'The Return of the Night Train',
      'Concrete That Repairs Itself',
      'In Defence of Boredom',
    ]);
    expect(conversion.content.sections.map((section) => section.type)).toEqual([
      'READING_PASSAGE',
      'READING_PASSAGE',
      'READING_PASSAGE',
    ]);
  });

  it('covers every major Reading question type', () => {
    const types = conversion.content.sections.flatMap((section) => section.groups.map((group) => group.type));
    expect(new Set(types)).toEqual(
      new Set([
        'TRUE_FALSE_NOT_GIVEN',
        'SENTENCE_COMPLETION',
        'MCQ_SINGLE',
        'MATCHING_HEADINGS',
        'MATCHING_INFORMATION',
        'SUMMARY_COMPLETION',
        'YES_NO_NOT_GIVEN',
        'MATCHING_FEATURES',
        'SHORT_ANSWER',
      ]),
    );
  });

  /** Both key shapes (option ids and accepted wordings) count as an answer. */
  function acceptedAnswers(key: EditableQuestion['answerKey']): string[] {
    if (!key || key.kind === 'MANUAL') return [];
    return key.kind === 'CHOICE' ? key.values : key.accept;
  }

  it('gives every question an answer key, marking evidence and an explanation', () => {
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
    const errors = issues.filter((issue) => issue.level === 'ERROR');
    expect(errors.map((issue) => `${issue.code}: ${issue.message}`)).toEqual([]);
    expect(summariseIssues(issues).publishable).toBe(true);
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
        if (!group.type.endsWith('COMPLETION') && group.type !== 'SHORT_ANSWER') continue;
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

  it('gives every matching group an option bank its answers belong to', () => {
    for (const section of conversion.content.sections) {
      for (const group of section.groups) {
        if (group.type !== 'MATCHING_HEADINGS' && group.type !== 'MATCHING_INFORMATION' && group.type !== 'MATCHING_FEATURES') {
          continue;
        }
        const optionIds = group.sharedOptions.map((option) => option.id);
        expect(optionIds.length, `${group.type} option bank`).toBeGreaterThanOrEqual(4);
        for (const question of group.questions) {
          for (const value of acceptedAnswers(question.answerKey)) {
            expect(optionIds, `Q${question.number} answer "${value}"`).toContain(value);
          }
        }
      }
    }
  });

  it('also converts when pasted into the version editor JSON tab', () => {
    // Admin → Tests → version → Edit content → JSON runs the same conversion
    // before saving; a payload this test rejects must not silently be accepted
    // there either.
    const editor = parseIntoEditableContent(payload);
    expect(editor.converted).toBe(true);
    expect(editor.issues).toEqual([]);
    expect(editor.content.sections).toHaveLength(3);
    expect(editor.content.durationSeconds).toBe(3600);
  });

  it('numbers each passage continuously and in reading order', () => {
    const expectedRanges = [
      { from: 1, to: 13 },
      { from: 14, to: 26 },
      { from: 27, to: 40 },
    ];
    conversion.content.sections.forEach((section, index) => {
      const numbers = section.groups
        .flatMap((group) => group.questions.map((question) => question.number))
        .sort((a, b) => a - b);
      expect(numbers[0]).toBe(expectedRanges[index]!.from);
      expect(numbers[numbers.length - 1]).toBe(expectedRanges[index]!.to);
      // No gaps and no duplicates inside a passage.
      expect(numbers).toEqual(
        Array.from({ length: expectedRanges[index]!.to - expectedRanges[index]!.from + 1 }, (_, offset) => expectedRanges[index]!.from + offset),
      );
    });
  });
});
