/**
 * 52: the admin version editor's JSON tab.
 *
 * Pasting a documented import file (e.g. `docs/samples/full-test.json`) into
 * the JSON tab used to fail `Save content` with one
 * `Invalid option: expected one of "READING"|"LISTENING"|"WRITING"` error per
 * section, because the tab only accepted the platform's editable content
 * schema. `parseIntoEditableContent` (shared with the import pipeline) must
 * convert such payloads into the editable tree before they are saved.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertAiPayload, parseIntoEditableContent } from '../../src/shared/import-convert';
import { isQuestionType } from '../../src/shared/question-types';

const fullTestPath = fileURLToPath(new URL('../../docs/samples/full-test.json', import.meta.url));
const fullTest = JSON.parse(readFileSync(fullTestPath, 'utf8')) as unknown;

const PLATFORM_SKILLS = ['READING', 'LISTENING', 'WRITING'];

describe('parseIntoEditableContent — version editor JSON tab', () => {
  it('converts the one-file FULL_MOCK sample into the editable content schema', () => {
    const { content, issues, converted } = parseIntoEditableContent(fullTest);

    expect(converted).toBe(true);
    expect(issues).toEqual([]);

    // Declared top-level metadata is honoured, not dropped.
    expect(content.durationSeconds).toBe(7200);
    expect(content.isCompleteTest).toBe(true);

    expect(content.sections).toHaveLength(6);
    expect(content.sections.map((section) => section.skill)).toEqual([
      'LISTENING',
      'READING',
      'READING',
      'READING',
      'WRITING',
      'WRITING',
    ]);
    expect(content.sections.map((section) => section.type)).toEqual([
      'LISTENING_PART',
      'READING_PASSAGE',
      'READING_PASSAGE',
      'READING_PASSAGE',
      'WRITING_TASK',
      'WRITING_TASK',
    ]);
    // This per-section skill check is what the server's zod schema enforces;
    // it is the exact field whose absence produced the six enum errors.
    for (const section of content.sections) {
      expect(PLATFORM_SKILLS).toContain(section.skill);
    }
  });

  it('keeps listening audio, transcript and label details', () => {
    const { content } = parseIntoEditableContent(fullTest);
    const listening = content.sections[0]!;
    expect(listening.label).toBe('Listening Part 2');
    expect(listening.title).toBe('The Football Stadium');
    expect(listening.audioUrl).toBe('ast_hbzm7pmirt1sh0lfgfur');
    expect(listening.transcript?.segments).toHaveLength(16);
    expect(listening.transcript?.segments[0]).toMatchObject({ id: 'ls01', speaker: 'Narrator' });
    expect(listening.groups.map((group) => group.type)).toEqual(['MCQ_SINGLE', 'MATCHING_FEATURES']);
    expect(listening.groups[0]!.rangeFrom).toBe(1);
    expect(listening.groups[0]!.rangeTo).toBe(4);
  });

  it('converts answers into typed answer keys', () => {
    const { content } = parseIntoEditableContent(fullTest);
    const listening = content.sections[0]!;
    // MCQ_SINGLE: single option id.
    expect(listening.groups[0]!.questions[0]!.answerKey).toMatchObject({ kind: 'CHOICE', values: ['B'] });
    // MATCHING_FEATURES: shared option bank, per-question letters.
    expect(listening.groups[1]!.sharedOptions).toHaveLength(8);
    expect(listening.groups[1]!.questions[0]!.answerKey).toMatchObject({ kind: 'CHOICE', values: ['D'] });

    const reading1 = content.sections[1]!;
    // MATCHING_HEADINGS keeps its roman numbering from `configuration`.
    expect(reading1.groups[0]!.config.optionNumbering).toBe('roman');
    // TRUE_FALSE_NOT_GIVEN answers are normalised to the choice vocabulary.
    expect(reading1.groups[1]!.questions[2]!.answerKey).toMatchObject({ kind: 'CHOICE', values: ['NOT_GIVEN'] });
    // SENTENCE_COMPLETION one-word answers become TEXT keys.
    expect(reading1.groups[2]!.questions[0]!.answerKey).toMatchObject({ kind: 'TEXT', accept: ['store'] });
  });

  it('carries writing minimum word counts and prompts', () => {
    const { content } = parseIntoEditableContent(fullTest);
    const task1 = content.sections[4]!;
    const task2 = content.sections[5]!;
    expect(task1.groups[0]!.type).toBe('WRITING_TASK_1');
    expect(task1.groups[0]!.config.minimumWords).toBe(150);
    expect(task2.groups[0]!.config.minimumWords).toBe(250);
    expect(task1.groups[0]!.questions[0]!.prompt).toContain('Placeholder');
  });

  it('reports 52 questions with a complete answer key', () => {
    const result = convertAiPayload(fullTest);
    expect(result.questionCount).toBe(52);
    expect(result.answerKeyConfidence).toBe('PROVIDED');
  });

  it('is idempotent: converted content passes through untouched', () => {
    const first = parseIntoEditableContent(fullTest);
    const second = parseIntoEditableContent(first.content);
    expect(second.converted).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.issues).toEqual([]);
  });

  it('every converted group uses a platform question type', () => {
    const { content } = parseIntoEditableContent(fullTest);
    for (const section of content.sections) {
      for (const group of section.groups) {
        expect(isQuestionType(group.type)).toBe(true);
      }
    }
  });

  it('reports unusable payloads as issues instead of throwing', () => {
    const { content, issues, converted } = parseIntoEditableContent({ nonsense: true });
    expect(converted).toBe(true);
    expect(content.sections).toHaveLength(0);
    expect(issues.some((issue) => issue.level === 'ERROR')).toBe(true);
  });
});
