import { describe, expect, it } from 'vitest';
import { buildLessonFromPayload, checkSentence, correctAnswerText, type Exercise } from '../../src/shared/learn-engine';
import { lessonItemCount, lessonPreview, normaliseLessonPayload } from '../../src/shared/lesson-payload';
import type { LessonPayload } from '../../src/shared/learn';

/**
 * The four lesson types beyond vocabulary.
 *
 * Their bodies come from a database row that an administrator may have written
 * by hand or that a provider may have written badly, so the interesting
 * behaviour is refusal: a body that cannot be played has to be rejected here
 * rather than producing a lesson with a missing answer.
 */

const PARAPHRASE = {
  kind: 'PARAPHRASE',
  items: [
    {
      original: 'The library closes early on Fridays.',
      answer: 'On Fridays, the library shuts early.',
      distractors: ['The library opens early on Fridays.', 'The library is closed all Friday.', 'Friday is the busiest day.'],
      note: '“close early” and “shut early” say the same thing.',
    },
  ],
};

const READING = {
  kind: 'READING',
  passage: 'The café on High Street serves breakfast until noon. After that, only drinks are available.',
  questions: [
    {
      stem: 'When does the café stop serving breakfast?',
      options: ['At noon', 'In the morning', 'At midnight', 'It never stops'],
      answer: 0,
      evidence: 'serves breakfast until noon',
    },
  ],
};

const WRITING = {
  kind: 'WRITING',
  items: [{ instruction: 'Viết câu: Tôi đã học tiếng Anh được ba năm.', model: 'I have studied English for three years.', hint: 'Present perfect + for' }],
};

const SPEAKING = {
  kind: 'SPEAKING',
  items: [{ question: 'Do you prefer studying alone or with others?', cue: 'a preference and a reason', sample: 'I prefer studying alone because I concentrate better.' }],
};

describe('normaliseLessonPayload · paraphrase', () => {
  it('accepts a complete item', () => {
    const payload = normaliseLessonPayload('PARAPHRASE', PARAPHRASE);
    expect(payload?.kind).toBe('PARAPHRASE');
    expect(lessonItemCount(payload!)).toBe(1);
    expect(lessonPreview(payload!)).toBe('The library closes early on Fridays.');
  });

  it('drops an item with fewer than three wrong options', () => {
    const short = { ...PARAPHRASE, items: [{ ...PARAPHRASE.items[0]!, distractors: ['one', 'two'] }] };
    expect(normaliseLessonPayload('PARAPHRASE', short)).toBeNull();
  });

  it('drops an item that lists the answer among its distractors', () => {
    const leaked = {
      ...PARAPHRASE,
      items: [{ ...PARAPHRASE.items[0]!, distractors: [PARAPHRASE.items[0]!.answer, 'two', 'three'] }],
    };
    expect(normaliseLessonPayload('PARAPHRASE', leaked)).toBeNull();
  });

  it('drops junk but keeps the usable item beside it', () => {
    const mixed = { items: [{ original: 'no distractors at all' }, ...PARAPHRASE.items] };
    const payload = normaliseLessonPayload('PARAPHRASE', mixed);
    expect(lessonItemCount(payload!)).toBe(1);
  });
});

describe('normaliseLessonPayload · reading', () => {
  it('accepts a passage with a four-option question', () => {
    const payload = normaliseLessonPayload('READING', READING);
    expect(payload?.kind).toBe('READING');
    expect(lessonPreview(payload!)).toContain('1 questions');
  });

  it('refuses a lesson with no passage, even with good questions', () => {
    expect(normaliseLessonPayload('READING', { ...READING, passage: '   ' })).toBeNull();
  });

  it('refuses an answer index outside the options', () => {
    const bad = { ...READING, questions: [{ ...READING.questions[0]!, answer: 4 }] };
    expect(normaliseLessonPayload('READING', bad)).toBeNull();
  });

  it('refuses repeated options and a fractional answer', () => {
    const repeated = { ...READING, questions: [{ ...READING.questions[0]!, options: ['a', 'a', 'b', 'c'] }] };
    expect(normaliseLessonPayload('READING', repeated)).toBeNull();
    const fractional = { ...READING, questions: [{ ...READING.questions[0]!, answer: 1.5 }] };
    expect(normaliseLessonPayload('READING', fractional)).toBeNull();
  });
});

describe('normaliseLessonPayload · writing and speaking', () => {
  it('needs both an instruction and a model answer', () => {
    expect(normaliseLessonPayload('WRITING', WRITING)?.kind).toBe('WRITING');
    expect(normaliseLessonPayload('WRITING', { items: [{ instruction: 'only a prompt' }] })).toBeNull();
    expect(normaliseLessonPayload('WRITING', { items: [{ model: 'only an answer' }] })).toBeNull();
  });

  it('needs both a question and a sample answer', () => {
    expect(normaliseLessonPayload('SPEAKING', SPEAKING)?.kind).toBe('SPEAKING');
    expect(normaliseLessonPayload('SPEAKING', { items: [{ question: 'no answer given' }] })).toBeNull();
  });

  it('refuses a kind it does not know rather than guessing', () => {
    expect(normaliseLessonPayload('LISTENING', SPEAKING)).toBeNull();
    expect(normaliseLessonPayload('SPEAKING', null)).toBeNull();
  });
});

describe('buildLessonFromPayload', () => {
  it('gives each kind its own exercise type', () => {
    const cases: Array<[string, string]> = [
      ['PARAPHRASE', 'paraphrase'],
      ['READING', 'read'],
      ['WRITING', 'write'],
      ['SPEAKING', 'speak'],
    ];
    const bodies: Record<string, unknown> = { PARAPHRASE, READING, WRITING, SPEAKING };
    for (const [kind, exerciseKind] of cases) {
      const payload = normaliseLessonPayload(kind, bodies[kind]) as LessonPayload;
      const exercises = buildLessonFromPayload(payload, 'seed-1');
      expect(exercises).toHaveLength(1);
      expect(exercises[0]!.kind).toBe(exerciseKind);
    }
  });

  it('is deterministic for the same seed and different for another', () => {
    const payload = normaliseLessonPayload('PARAPHRASE', PARAPHRASE) as LessonPayload;
    expect(buildLessonFromPayload(payload, 'seed-1')).toEqual(buildLessonFromPayload(payload, 'seed-1'));
    // The option order is shuffled, so a different seed may reorder it — but the
    // answer index must always point at the same sentence.
    for (const exercise of buildLessonFromPayload(payload, 'seed-2') as Array<Exercise & { options: string[]; answer: number }>) {
      expect(exercise.options[exercise.answer]).toBe(PARAPHRASE.items[0]!.answer);
    }
  });

  it('puts the right text in every "correct answer" panel', () => {
    const writing = buildLessonFromPayload(normaliseLessonPayload('WRITING', WRITING) as LessonPayload, 's')[0]!;
    expect(correctAnswerText(writing)).toBe('I have studied English for three years.');
    const speaking = buildLessonFromPayload(normaliseLessonPayload('SPEAKING', SPEAKING) as LessonPayload, 's')[0]!;
    expect(correctAnswerText(speaking)).toBe('I prefer studying alone because I concentrate better.');
  });

  it('carries an explanation on every exercise, whatever the kind', () => {
    const bodies = [PARAPHRASE, READING, WRITING, SPEAKING];
    for (const body of bodies) {
      const payload = normaliseLessonPayload(body.kind, body) as LessonPayload;
      for (const exercise of buildLessonFromPayload(payload, 's')) {
        expect(exercise.explain.term.length).toBeGreaterThan(0);
        expect(exercise.explain.pos.length).toBeGreaterThan(0);
      }
    }
  });

  it('skips a question whose stem or options are broken instead of crashing', () => {
    const payload = normaliseLessonPayload('READING', {
      ...READING,
      questions: [...READING.questions, { stem: '', options: ['a', 'b', 'c', 'd'], answer: 0, evidence: '' }],
    }) as LessonPayload;
    expect(buildLessonFromPayload(payload, 's')).toHaveLength(1);
  });
});

describe('checkSentence', () => {
  const model = 'I have studied English for three years.';

  it('accepts the model answer with or without its final full stop', () => {
    expect(checkSentence(model, model)).toEqual({ correct: true, almost: false });
    expect(checkSentence('I have studied English for three years', model)).toEqual({ correct: true, almost: false });
  });

  it('ignores capitalisation and doubled spaces', () => {
    expect(checkSentence('i have  studied english FOR three years.', model)).toEqual({ correct: true, almost: false });
  });

  it('forgives a small slip but not a different sentence', () => {
    expect(checkSentence('I have studyed English for three years.', model).correct).toBe(true);
    expect(checkSentence('I studied English last year.', model).correct).toBe(false);
    expect(checkSentence('', model)).toEqual({ correct: false, almost: false });
  });

  it('allows more slips in a longer answer, not a fixed number', () => {
    const shortModel = 'She runs fast.';
    const longModel = 'The government has invested heavily in renewable energy over the past decade.';
    expect(checkSentence('She run fast.', shortModel).correct).toBe(true);
    expect(checkSentence('The government has invested heavily in renewable energy over the past decads', longModel).correct).toBe(
      true,
    );
  });
});
