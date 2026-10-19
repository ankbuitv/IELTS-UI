import { describe, expect, it } from 'vitest';
import {
  missingQuestionIds,
  responseHasContent,
  type CoverageQuestion,
} from '../../src/client/components/exam/answer-coverage';

const base = { answers: {}, writing: {}, essayIds: new Set<string>() };

describe('exam answer coverage', () => {
  it('treats whitespace as empty and any typed value as answered', () => {
    expect(responseHasContent(null)).toBe(false);
    expect(responseHasContent({ value: '   ' })).toBe(false);
    expect(responseHasContent({ value: 'C' })).toBe(true);
    expect(responseHasContent({ values: ['', '  '] })).toBe(false);
    expect(responseHasContent({ values: ['', 'paragraph B'] })).toBe(true);
  });

  it('counts two questions that reuse the same number as two answers', () => {
    // A real import can restart at 1 in each part; both questions are answered.
    const questions: CoverageQuestion[] = [
      { id: 'q_s1_1', number: 1 },
      { id: 'q_s1_2', number: 2 },
      { id: 'q_s2_1', number: 1 },
      { id: 'q_s2_2', number: 2 },
    ];
    const missing = missingQuestionIds(questions, {
      ...base,
      answers: {
        q_s1_1: { value: 'A' },
        q_s1_2: { value: 'B' },
        q_s2_1: { value: 'C' },
        q_s2_2: { value: 'D' },
      },
    });
    expect(missing).toEqual([]);
  });

  it('reports only the ids that are genuinely empty', () => {
    const questions: CoverageQuestion[] = [
      { id: 'q1', number: 1 },
      { id: 'q2', number: 2 },
      { id: 'q3', number: 3 },
    ];
    const missing = missingQuestionIds(questions, {
      ...base,
      answers: { q1: { value: 'A' }, q2: { value: ' ' } },
    });
    expect(missing).toEqual(['q2', 'q3']);
  });

  it('requires text before a writing task counts as answered', () => {
    const questions: CoverageQuestion[] = [
      { id: 'task1', number: 1 },
      { id: 'task2', number: 2 },
    ];
    const essayIds = new Set(['task1', 'task2']);
    expect(missingQuestionIds(questions, { ...base, essayIds, writing: { task1: '  ' } })).toEqual(['task1', 'task2']);
    expect(missingQuestionIds(questions, { ...base, essayIds, writing: { task1: 'An essay.' } })).toEqual(['task2']);
  });
});
