import { describe, expect, it } from 'vitest';
import { buildGenerationPrompt } from '../../src/worker/ai/openai';

describe('buildGenerationPrompt', () => {
  it('carries the band, section and question counts into the brief', () => {
    const prompt = buildGenerationPrompt({
      prompt: 'Urban farming in Singapore',
      title: 'Growing up',
      band: 7,
      sections: 2,
      questionsPerSection: 8,
    });
    expect(prompt).toContain('band 7');
    expect(prompt).toContain('2 Reading section');
    expect(prompt).toContain('Questions per section: 8');
    expect(prompt).toContain('Working title: Growing up');
    expect(prompt).toContain('Urban farming in Singapore');
    expect(prompt).toContain('one JSON object');
  });

  it('omits an empty title without leaving a blank line', () => {
    const prompt = buildGenerationPrompt({ prompt: 'Coastal erosion', band: 6, sections: 1, questionsPerSection: 10 });
    expect(prompt).not.toContain('Working title');
    expect(prompt.split('\n').every((line) => line.trim().length > 0)).toBe(true);
  });
});
