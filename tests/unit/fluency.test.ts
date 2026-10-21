import { describe, expect, it } from 'vitest';
import { analyseFluency } from '../../src/shared/fluency';

describe('analyseFluency', () => {
  it('computes pace and flags a slow answer', () => {
    const report = analyseFluency({ transcript: 'I live in a small city near the river.', durationSeconds: 60 });
    expect(report.words).toBe(9);
    expect(report.wordsPerMinute).toBe(9);
    expect(report.pace).toBe('SLOW');
    expect(report.advice).toMatch(/below 110/);
  });

  it('counts fillers and repeated content words', () => {
    const report = analyseFluency({
      transcript:
        'Um, I really like my hometown because my hometown is quiet, and my hometown has a market. You know, it is nice.',
      durationSeconds: 12,
    });
    expect(report.fillerCount).toBeGreaterThanOrEqual(2);
    expect(report.fillers[0]?.word).toBeTruthy();
    expect(report.repeated.some((entry) => entry.word === 'hometown')).toBe(true);
    expect(report.advice.length).toBeGreaterThan(10);
  });

  it('handles an empty transcript without dividing by zero', () => {
    const report = analyseFluency({ transcript: '', durationSeconds: 0 });
    expect(report).toMatchObject({ words: 0, wordsPerMinute: 0, pace: 'UNKNOWN', lexicalVariety: 0 });
  });

  it('reports healthy delivery as steady', () => {
    const words = new Array(130).fill('different').join(' ');
    const report = analyseFluency({ transcript: words, durationSeconds: 60 });
    expect(report.pace).toBe('STEADY');
    expect(report.lexicalVariety).toBeLessThan(0.2);
  });
});
