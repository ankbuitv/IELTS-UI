import { describe, expect, it } from 'vitest';
import { buildSpeakingMessages, buildWritingMessages } from '../../src/worker/ai/marking-prompts';

const writingInput = {
  taskLabel: 'Task 2',
  prompt: 'Some people think X. Discuss.',
  responseText: 'A candidate response with enough words to judge.',
  wordCount: 280,
  minimumWords: 250,
};

describe('writing marking prompt', () => {
  it('does not leak the candidate level hint to the scoring judge', () => {
    const messages = buildWritingMessages({ ...writingInput, levelHint: 4.5 });
    const joined = messages.map((message) => message.content).join('\n');
    expect(joined).not.toContain('CANDIDATE LEVEL HINT');
    expect(joined).not.toContain('recent overall estimate');
  });

  it('tells the judge not to invent grammar errors and to keep style out of corrections', () => {
    const joined = buildWritingMessages(writingInput)
      .map((message) => message.content)
      .join('\n');
    expect(joined).toContain('GENUINE language errors only');
    expect(joined).toContain('Do not invent an error merely to have something to say');
    expect(joined).toContain('put an optional rephrasing in "improvements" instead');
  });

  it('warns against inflating a polished but thinly reasoned response to band 8', () => {
    const joined = buildWritingMessages(writingInput)
      .map((message) => message.content)
      .join('\n');
    expect(joined).toContain('reasons thinly belongs at 7, not 8');
  });
});

describe('speaking marking prompt', () => {
  it('does not leak the level hint and keeps corrections to genuine errors', () => {
    const messages = buildSpeakingMessages({
      topicTitle: 'Cooking',
      parts: [{ part: 1, prompt: 'Do you cook?', transcript: 'Yes I cook every day.', durationSeconds: 20 }],
      levelHint: 5,
    });
    const joined = messages.map((message) => message.content).join('\n');
    expect(joined).not.toContain('CANDIDATE LEVEL HINT');
    expect(joined).toContain('GENUINE language errors only');
  });
});
