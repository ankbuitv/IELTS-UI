import { describe, expect, it } from 'vitest';
import { deriveTestSummary } from '../../src/worker/services/test-summary';

/**
 * The description a practice test gets after import.
 *
 * It used to be "Imported from <file>.json", which read like a bug. The derived
 * summary must instead be true statements about the content, and it must be
 * produced with no AI provider at all (this test runs the pure pass only).
 */

const content = {
  sections: [
    {
      skill: 'READING',
      groups: [
        { questions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
        { questions: [1, 2, 3, 4, 5, 6, 7] },
      ],
    },
    { skill: 'LISTENING', groups: [{ questions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }] },
  ],
};

describe('deriveTestSummary', () => {
  it('counts sections and questions per skill', () => {
    const summary = deriveTestSummary('Cambridge 18 Test 1', 'FULL_MOCK', content);
    expect(summary).toContain('full mock');
    expect(summary).toContain('2 sections');
    expect(summary).toContain('30 questions');
    expect(summary).toContain('Reading (20)');
    expect(summary).toContain('Listening (10)');
  });

  it('never mentions the source file or import', () => {
    const summary = deriveTestSummary('Any Test', 'READING', content);
    expect(summary.toLowerCase()).not.toContain('imported');
    expect(summary.toLowerCase()).not.toContain('.json');
    expect(summary.toLowerCase()).not.toContain('file');
  });

  it('still says something true for an empty test', () => {
    const summary = deriveTestSummary('Empty', 'READING', { sections: [] });
    expect(summary).toContain('Empty');
    expect(summary).toContain('Reading');
  });
});
