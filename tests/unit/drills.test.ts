import { describe, expect, it } from 'vitest';
import { countAnsweredDrillQuestions, isAnsweredDrillResponse, toDrillSubmission } from '../../src/shared/drills';

describe('drill submission glue', () => {
  it('treats whitespace-only text as unanswered', () => {
    expect(isAnsweredDrillResponse({ value: '   ' })).toBe(false);
    expect(isAnsweredDrillResponse({ value: ' 42 ' })).toBe(true);
  });

  it('treats an empty multi-select as unanswered', () => {
    expect(isAnsweredDrillResponse({ values: [] })).toBe(false);
    expect(isAnsweredDrillResponse({ values: ['opt_a'] })).toBe(true);
  });

  it('ignores null responses', () => {
    expect(isAnsweredDrillResponse(null)).toBe(false);
    expect(isAnsweredDrillResponse(undefined)).toBe(false);
  });

  it('counts only answered questions', () => {
    expect(
      countAnsweredDrillQuestions({
        q1: { value: 'TRUE' },
        q2: { value: '  ' },
        q3: { values: ['opt_a', 'opt_c'] },
        q4: null,
      }),
    ).toBe(2);
  });

  it('drops blank answers from the wire payload', () => {
    const payload = toDrillSubmission({
      q1: { value: '  TRUE ' },
      q2: { value: '' },
      q3: { values: ['opt_b'] },
    });
    expect(payload).toEqual({ q1: { value: 'TRUE' }, q3: { values: ['opt_b'] } });
  });

  it('copies value arrays so later UI edits cannot mutate the sent payload', () => {
    const values = ['opt_a'];
    const payload = toDrillSubmission({ q1: { values } });
    values.push('opt_b');
    expect(payload.q1).toEqual({ values: ['opt_a'] });
  });

  it('trims text answers before sending', () => {
    expect(toDrillSubmission({ q1: { value: '\n  Paris  \n' } }).q1).toEqual({ value: 'Paris' });
  });
});
