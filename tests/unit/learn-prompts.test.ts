import { describe, expect, it } from 'vitest';
import { buildLessonGenerationMessages } from '../../src/worker/ai/learn-prompts';

describe('lesson generation contracts', () => {
  const base = {
    band: 6.5 as const,
    count: 1,
    items: 30,
    unitTitle: 'Skill practice',
    avoidTitles: [],
    avoidTerms: [],
  };

  it('asks Reading for a source passage and the exact full drill length', () => {
    const system = buildLessonGenerationMessages({ ...base, kind: 'READING' })[0]!.content;
    expect(system).toContain('450 to 650 words');
    expect(system).toContain('exactly 30 playable items');
    expect(system).toContain('short reading drill, not a full-length test');
    expect(system).toContain('evidence');
  });

  it('requires a real, self-contained Writing task before its sentence drills', () => {
    const system = buildLessonGenerationMessages({ ...base, kind: 'WRITING' })[0]!.content;
    expect(system).toContain('"taskPrompt"');
    expect(system).toContain('"taskType"');
    expect(system).toContain('include every relevant category, unit, time period and figure directly');
    expect(system).toContain('Label invented values as fictional practice data');
    expect(system).toContain('exactly 30 playable items');
    expect(system).not.toContain('recommend citations');
  });

  it('asks Speaking for examiner-style questions and spoken model answers', () => {
    const system = buildLessonGenerationMessages({ ...base, kind: 'SPEAKING' })[0]!.content;
    expect(system).toContain('exactly 30 playable items');
    expect(system).toContain('35 to 60 words');
    expect(system).toContain('Never ask about the learner\'s income');
  });
});
