import { describe, expect, it } from 'vitest';
import { summariseAnswerTimes } from '../../src/shared/time-analysis';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();

describe('summariseAnswerTimes', () => {
  it('attributes the gap between saves to the later question', () => {
    const report = summariseAnswerTimes(
      [
        { number: 1, prompt: 'One', answeredAt: at(10), isCorrect: true },
        { number: 2, prompt: 'Two', answeredAt: at(40), isCorrect: false },
        { number: 3, prompt: 'Three', answeredAt: at(70), isCorrect: true },
      ],
      at(0),
    );
    expect(report.perQuestion.map((question) => question.seconds)).toEqual([10, 30, 30]);
    expect(report.totalSeconds).toBe(70);
    expect(report.slowest).toHaveLength(3);
    expect(report.correctAverage).toBe(20);
    expect(report.incorrectAverage).toBe(30);
  });

  it('ignores long breaks and sub-second saves', () => {
    const report = summariseAnswerTimes([
      { number: 1, prompt: 'One', answeredAt: at(0), isCorrect: true },
      { number: 2, prompt: 'Two', answeredAt: at(3600), isCorrect: null },
      { number: 3, prompt: 'Three', answeredAt: at(3600.4), isCorrect: null },
      { number: 4, prompt: 'Four', answeredAt: at(3610), isCorrect: null },
    ]);
    expect(report.perQuestion.find((question) => question.number === 2)?.seconds).toBe(0);
    expect(report.perQuestion.find((question) => question.number === 3)?.seconds).toBe(0);
    expect(report.perQuestion.find((question) => question.number === 4)?.seconds).toBe(10);
  });

  it('counts unanswered questions', () => {
    const report = summariseAnswerTimes([
      { number: 1, prompt: 'One', answeredAt: at(5), isCorrect: true },
      { number: 2, prompt: 'Two', answeredAt: null, isCorrect: null },
    ]);
    expect(report.unanswered).toBe(1);
    expect(report.answered).toBe(1);
  });
});
