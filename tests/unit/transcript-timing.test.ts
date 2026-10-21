import { describe, expect, it } from 'vitest';
import { buildWordTimings, findEvidenceStart, normaliseWord } from '../../src/shared/transcript-timing';

const segments = [
  { id: 's1', startSeconds: null, text: 'Good morning and welcome to the stadium.' },
  { id: 's2', startSeconds: null, text: 'The tour begins at nine.' },
];

describe('buildWordTimings', () => {
  it('spreads words over the known audio duration, in order', () => {
    const timings = buildWordTimings(segments, { durationSeconds: 10 });
    expect(timings).toHaveLength(12);
    expect(timings[0]!.startSeconds).toBe(0);
    expect(timings.at(-1)!.endSeconds).toBeCloseTo(10, 1);
    for (let index = 1; index < timings.length; index += 1) {
      expect(timings[index]!.startSeconds).toBeGreaterThanOrEqual(timings[index - 1]!.startSeconds);
    }
  });

  it('honours explicit segment anchors over the estimate', () => {
    const anchored = [
      { id: 'a', startSeconds: 5, text: 'one two three' },
      { id: 'b', startSeconds: 20, text: 'four five six' },
    ];
    const timings = buildWordTimings(anchored, { durationSeconds: 30 });
    expect(timings[0]!.startSeconds).toBe(5);
    expect(timings.find((timing) => timing.segmentId === 'b')!.startSeconds).toBe(20);
  });

  it('estimates without audio instead of returning nothing', () => {
    const timings = buildWordTimings(segments, {});
    expect(timings).toHaveLength(12);
    expect(timings.at(-1)!.endSeconds).toBeGreaterThan(3);
  });

  it('strips punctuation for dictionary lookups', () => {
    expect(normaliseWord('“Stadium’s,”')).toBe('stadium');
    expect(normaliseWord('(nine)')).toBe('nine');
  });
});

describe('findEvidenceStart', () => {
  const timings = buildWordTimings(
    [{ id: 'ls1', startSeconds: 0, text: 'Stadium stairs are steep and the tunnel is very dark.' }],
    { durationSeconds: 6 },
  );

  it('lands on the first word of a quoted sentence', () => {
    const start = findEvidenceStart(timings, 'ls1', 'segment:ls1 "the tunnel is very dark"');
    const the = timings.find((timing) => timing.normalized === 'the')!;
    expect(start).toBeCloseTo(the.startSeconds, 2);
  });

  it('falls back to the segment start when the evidence is paraphrased', () => {
    expect(findEvidenceStart(timings, 'ls1', 'segment:ls1 the arena is gloomy')).toBe(timings[0]!.startSeconds);
  });

  it('returns null for a segment that is not in the transcript', () => {
    expect(findEvidenceStart(timings, 'missing', 'anything')).toBeNull();
  });
});
