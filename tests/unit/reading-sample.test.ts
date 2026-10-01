import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseIntoEditableContent } from '../../src/shared/import-convert';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '../../docs/samples/reading-4-passages.json');

describe('reading sample (docs/samples/reading-4-passages.json)', () => {
  const raw = JSON.parse(readFileSync(samplePath, 'utf8'));

  it('is a READING test with four passages', () => {
    expect(raw.testType).toBe('READING');
    expect(raw.sections).toHaveLength(4);
  });

  it('converts to editable content with four sections and 40 questions', () => {
    const { content, issues } = parseIntoEditableContent(raw);
    expect(content.sections).toHaveLength(4);

    const questionCount = content.sections.reduce(
      (total, section) => total + section.groups.reduce((inner, group) => inner + group.questions.length, 0),
      0,
    );
    expect(questionCount).toBe(40);

    // The sample is authored to be warning-free on conversion.
    const errors = issues.filter((issue) => issue.level === 'ERROR');
    expect(errors).toEqual([]);
  });

  it('keeps answer keys for every question', () => {
    const { content } = parseIntoEditableContent(raw);
    const missing = content.sections
      .flatMap((section) => section.groups)
      .flatMap((group) => group.questions)
      .filter((question) => !question.answerKey);
    expect(missing).toHaveLength(0);
  });
});
