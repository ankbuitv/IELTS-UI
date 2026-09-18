import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLeadingJson } from '../../src/shared/json';
import { convertAiPayload } from '../../src/worker/services/import-service';

describe('parseLeadingJson', () => {
  it('parses a single object', () => {
    const result = parseLeadingJson('{"a":1}');
    expect(result?.value).toEqual({ a: 1 });
    expect(result?.trailing).toBe(false);
  });

  it('takes the first object when a second document follows', () => {
    const result = parseLeadingJson('{"testTitle":"One"}\n{"schemaVersion":"1.0"}');
    expect(result?.value).toEqual({ testTitle: 'One' });
    expect(result?.trailing).toBe(true);
  });

  it('ignores a markdown fence and commentary after the object', () => {
    const result = parseLeadingJson('{"ok":true}\n```\nextra\n```');
    expect(result?.value).toEqual({ ok: true });
    expect(result?.trailing).toBe(true);
  });

  it('returns null for plain text', () => {
    expect(parseLeadingJson('not json at all')).toBeNull();
  });
});

describe('convertAiPayload — source document and already-converted drafts', () => {
  it('converts a schemaVersion source document with a separate answer key', () => {
    const source = {
      schemaVersion: '1.0',
      skill: 'reading',
      metadata: { title: 'Source reading', durationMinutes: 60 },
      sections: [
        {
          title: 'Passage 1',
          passage: {
            title: 'Coastal Weather',
            paragraphs: [{ label: 'A', text: 'Storms form offshore in winter.' }],
          },
          questionGroups: [
            {
              questionType: 'true_false_not_given',
              instructions: 'Write TRUE, FALSE or NOT GIVEN.',
              questions: [{ number: 1, prompt: 'Storms form offshore.' }],
            },
          ],
        },
      ],
      answerKey: [{ questionNumber: 1, answer: 'TRUE', evidence: [{ paragraphLabel: 'A', quote: 'Storms form offshore in winter.' }] }],
    };
    const result = convertAiPayload(source);
    expect(result.questionCount).toBe(1);
    expect(result.answerKeyConfidence).toBe('PROVIDED');
    expect(result.content.sections[0]!.groups[0]!.type).toBe('TRUE_FALSE_NOT_GIVEN');
    expect(result.content.sections[0]!.groups[0]!.questions[0]!.answerKey).toEqual({ kind: 'CHOICE', values: ['TRUE'] });
    expect(result.content.durationSeconds).toBe(3600);
  });

  it('converts the Cities, Knowledge and Adaptation sample (both formats)', () => {
    const ai = JSON.parse(readFileSync('docs/samples/cities-knowledge-and-adaptation.json', 'utf8')) as unknown;
    const source = JSON.parse(readFileSync('docs/samples/cities-knowledge-and-adaptation.source.json', 'utf8')) as unknown;
    const fromAi = convertAiPayload(ai);
    const fromSource = convertAiPayload(source);
    expect(fromAi.questionCount).toBe(40);
    expect(fromSource.questionCount).toBe(40);
    expect(fromAi.answerKeyConfidence).toBe('PROVIDED');
    expect(fromSource.answerKeyConfidence).toBe('PROVIDED');
    expect(fromAi.content.sections).toHaveLength(3);
    expect(fromAi.content.durationSeconds).toBe(3600);
    expect(fromAi.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    expect(fromSource.issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
  });

  it('re-accepts already converted editable content instead of rejecting it', () => {
    const converted = convertAiPayload({
      testTitle: 'Coastal Weather Systems',
      testType: 'READING',
      answerKeyConfidence: 'PROVIDED',
      warnings: [],
      passages: [{ title: 'Coastal Weather', paragraphs: [{ label: 'A', text: 'First paragraph.' }] }],
      sections: [
        {
          skill: 'READING',
          title: 'Passage 1',
          instructions: 'Answer the questions.',
          passageIndex: 0,
          audioProvided: false,
          groups: [
            {
              questionType: 'TRUE_FALSE_NOT_GIVEN',
              instructions: 'Write TRUE, FALSE or NOT GIVEN.',
              sharedOptions: [],
              questions: [{ number: 1, prompt: 'Storms form offshore.', options: [], answer: 'TRUE' }],
            },
          ],
        },
      ],
    });
    const again = convertAiPayload(converted.content);
    expect(again.questionCount).toBe(1);
    expect(again.content.sections[0]!.groups[0]!.type).toBe('TRUE_FALSE_NOT_GIVEN');
    expect(again.content.durationSeconds).toBe(3600);
  });
});
