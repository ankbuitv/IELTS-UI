import { describe, expect, it } from 'vitest';
import {
  SPEAKING_PARTNER_TOPICS,
  nextFallbackQuestion,
  ruleFeedback,
  ruleSummary,
  topicById,
} from '../../src/shared/speaking-partner';

const part1 = topicById('hometown')!;

describe('speaking partner topics', () => {
  it('covers all three parts with usable prompts', () => {
    expect(SPEAKING_PARTNER_TOPICS.length).toBeGreaterThanOrEqual(9);
    for (const part of [1, 2, 3]) {
      expect(SPEAKING_PARTNER_TOPICS.some((topic) => topic.part === part)).toBe(true);
    }
    for (const topic of SPEAKING_PARTNER_TOPICS) {
      expect(topic.prompt.length).toBeGreaterThan(20);
      expect(topic.followUps.length).toBeGreaterThanOrEqual(2);
      expect(topic.focus.length).toBeGreaterThan(10);
    }
    expect(topicById('missing')).toBeNull();
  });

  it('cycles fallback questions', () => {
    expect(nextFallbackQuestion(part1, 0)).toBe(part1.followUps[0]);
    expect(nextFallbackQuestion(part1, 1)).toBe(part1.followUps[1]);
    expect(nextFallbackQuestion(part1, 2)).toBe(part1.followUps[0]);
  });
});

describe('rule-based coaching', () => {
  it('asks for more language on a one-line answer', () => {
    const feedback = ruleFeedback('It is nice.', part1);
    expect(feedback.source).toBe('RULES');
    expect(feedback.notes[0]).toMatch(/two- or three-sentence/);
    expect(feedback.notes.length).toBeLessThanOrEqual(3);
  });

  it('credits linking words and flags filler', () => {
    const feedback = ruleFeedback(
      'My hometown is quite lively because there is a big market, although the traffic is terrible. Um, I still like living there since my family is close.',
      part1,
    );
    expect(feedback.notes.join(' ')).not.toMatch(/Connect your ideas/);
    expect(feedback.notes.join(' ')).toMatch(/filler/);
  });

  it('notes short Part 2 answers specifically', () => {
    const part2 = topicById('journey')!;
    const feedback = ruleFeedback('I went to Da Lat with my friends last year because it was cheap.', part2);
    expect(feedback.notes.join(' ')).toMatch(/Part 2/);
  });

  it('never invents a band', () => {
    const feedback = ruleFeedback('x'.repeat(200), part1);
    expect(JSON.stringify(feedback)).not.toMatch(/band/i);
  });
});

describe('rule-based summary', () => {
  it('counts answers and carries the coaching notes forward', () => {
    const summary = ruleSummary(part1, ['I live in Bien Hoa because it is near Saigon.', 'It has become busier.'], [
      'Add an example.',
    ]);
    expect(summary.headline).toContain('2 questions');
    expect(summary.improvements).toEqual(['Add an example.']);
    expect(summary.nextSteps.length).toBeGreaterThanOrEqual(2);
    expect(summary.source).toBe('RULES');
  });
});
