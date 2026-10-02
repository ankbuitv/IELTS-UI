import { describe, expect, it } from 'vitest';
import {
  LESSONS,
  UNITS,
  WORD_BANK,
  findBankWord,
  lessonById,
  startIndexForLevel,
  unlockedThrough,
} from '../../src/shared/learn-content';
import {
  blankOut,
  buildLesson,
  buildReviewLesson,
  checkOrder,
  checkTyped,
  correctAnswerText,
  scoreLesson,
  seededRandom,
  sentenceTokens,
} from '../../src/shared/learn-engine';
import {
  isPlausibleDay,
  lessonXp,
  levelForBand,
  nextStreak,
  starsFor,
  streakAlive,
  utcDay,
} from '../../src/shared/learn';
import { LEITNER_DAYS, nextLeitner } from '../../src/shared/vocabulary';

describe('learning path content', () => {
  it('has four units of four lessons with six words each', () => {
    expect(UNITS).toHaveLength(4);
    expect(LESSONS).toHaveLength(16);
    for (const lesson of LESSONS) expect(lesson.words).toHaveLength(6);
    expect(LESSONS.map((lesson) => lesson.index)).toEqual(Array.from({ length: 16 }, (_, index) => index));
  });

  it('uses unique lesson ids and unique words', () => {
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length);
    const terms = WORD_BANK.map((word) => word.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('writes every example sentence so it contains the word exactly (needed for fill-in-the-blank)', () => {
    for (const word of WORD_BANK) {
      expect(word.example.toLowerCase(), word.term).toContain(word.term.toLowerCase());
      expect(word.meaning.length, word.term).toBeGreaterThan(5);
      expect(word.vi.length, word.term).toBeGreaterThan(1);
    }
  });

  it('starts each level at the first lesson of its tier', () => {
    expect([4, 5, 6, 7].map((level) => startIndexForLevel(level as 4 | 5 | 6 | 7))).toEqual([0, 4, 8, 12]);
  });

  it('opens the lesson after the furthest finished one, or the tier start, whichever is later', () => {
    expect(unlockedThrough(-1, 4)).toBe(0);
    expect(unlockedThrough(2, 4)).toBe(3);
    expect(unlockedThrough(-1, 6)).toBe(8);
    expect(unlockedThrough(9, 6)).toBe(10);
  });

  it('finds lessons and bank words by id and term', () => {
    expect(lessonById('u3-l2')?.title).toBe('Cause and effect');
    expect(lessonById('nope')).toBeNull();
    expect(findBankWord('  Mitigate ')?.vi).toBe('giảm nhẹ');
  });
});

describe('learn rules', () => {
  it('maps a band to a starting tier, defaulting to the middle', () => {
    expect(levelForBand(null)).toBe(5);
    expect(levelForBand(undefined)).toBe(5);
    expect(levelForBand(3.5)).toBe(4);
    expect(levelForBand(4.5)).toBe(5);
    expect(levelForBand(5.5)).toBe(5);
    expect(levelForBand(6)).toBe(6);
    expect(levelForBand(6.5)).toBe(6);
    expect(levelForBand(7)).toBe(7);
    expect(levelForBand(8.5)).toBe(7);
  });

  it('pays 10 + correct + 5 for perfect, and half for a repeat', () => {
    expect(lessonXp({ correct: 10, total: 10, completionsBefore: 0 })).toBe(25);
    expect(lessonXp({ correct: 7, total: 10, completionsBefore: 0 })).toBe(17);
    expect(lessonXp({ correct: 10, total: 10, completionsBefore: 1 })).toBe(13);
    expect(lessonXp({ correct: 0, total: 0, completionsBefore: 0 })).toBe(10);
    // Never more than the exercises that exist.
    expect(lessonXp({ correct: 99, total: 10, completionsBefore: 0 })).toBe(25);
  });

  it('awards one to three stars by first-try accuracy', () => {
    expect(starsFor(10, 10)).toBe(3);
    expect(starsFor(9, 10)).toBe(3);
    expect(starsFor(8, 10)).toBe(2);
    expect(starsFor(7, 10)).toBe(2);
    expect(starsFor(3, 10)).toBe(1);
    expect(starsFor(0, 0)).toBe(1);
  });

  it('keeps a streak across consecutive days, holds it on the same day and resets after a gap', () => {
    expect(nextStreak({ streak: 0, lastDay: null }, '2026-10-02')).toBe(1);
    expect(nextStreak({ streak: 4, lastDay: '2026-10-02' }, '2026-10-02')).toBe(4);
    expect(nextStreak({ streak: 4, lastDay: '2026-10-01' }, '2026-10-02')).toBe(5);
    expect(nextStreak({ streak: 4, lastDay: '2026-09-29' }, '2026-10-02')).toBe(1);
    expect(nextStreak({ streak: 4, lastDay: '2026-09-30' }, '2026-10-01')).toBe(5); // month boundary
    expect(streakAlive('2026-10-01', '2026-10-02')).toBe(true);
    expect(streakAlive('2026-09-30', '2026-10-02')).toBe(false);
    expect(streakAlive(null, '2026-10-02')).toBe(false);
  });

  it('accepts a local day within one day of UTC and rejects anything else', () => {
    const now = Date.parse('2026-10-02T03:00:00Z');
    expect(utcDay(now)).toBe('2026-10-02');
    expect(isPlausibleDay('2026-10-02', now)).toBe(true);
    expect(isPlausibleDay('2026-10-03', now)).toBe(true);
    expect(isPlausibleDay('2026-10-01', now)).toBe(true);
    expect(isPlausibleDay('2026-10-05', now)).toBe(false);
    expect(isPlausibleDay('2026-02-30', now)).toBe(false);
    expect(isPlausibleDay('yesterday', now)).toBe(false);
  });
});

describe('exercise engine', () => {
  it('is deterministic for a seed and varies between seeds', () => {
    const lesson = lessonById('u2-l1')!;
    const a = buildLesson(lesson.words, 'seed-a');
    const b = buildLesson(lesson.words, 'seed-a');
    const c = buildLesson(lesson.words, 'seed-b');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    const rand = seededRandom('x');
    const first = rand();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });

  it('builds a varied lesson of at least nine exercises for every lesson on the path', () => {
    for (const lesson of LESSONS) {
      const exercises = buildLesson(lesson.words, lesson.id);
      expect(exercises.length, lesson.id).toBeGreaterThanOrEqual(9);
      const kinds = new Set(exercises.map((exercise) => exercise.kind));
      for (const kind of ['choose', 'match', 'fill', 'listen', 'type']) expect(kinds.has(kind as never), `${lesson.id} ${kind}`).toBe(true);
      expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(exercises.length);
    }
  });

  it('always includes the correct answer exactly once among distinct options', () => {
    for (const lesson of LESSONS) {
      for (const exercise of buildLesson(lesson.words, `${lesson.id}:check`)) {
        if (exercise.kind === 'choose' || exercise.kind === 'fill' || exercise.kind === 'listen') {
          expect(new Set(exercise.options).size, `${lesson.id} ${exercise.kind}`).toBe(exercise.options.length);
          expect(exercise.options).toHaveLength(4);
          const expected = exercise.kind === 'choose' ? exercise.explain.meaning : exercise.explain.term;
          expect(exercise.options[exercise.answer]).toBe(expected);
          expect(correctAnswerText(exercise)).toBe(expected);
        }
        if (exercise.kind === 'fill') {
          expect(exercise.sentence).toContain('____');
          expect(exercise.sentence.toLowerCase()).not.toContain(exercise.explain.term.toLowerCase());
        }
      }
    }
  });

  it('never leaves an order exercise already solved', () => {
    for (const lesson of LESSONS) {
      for (const exercise of buildLesson(lesson.words, `${lesson.id}:order`)) {
        if (exercise.kind !== 'order') continue;
        expect([...exercise.tokens].sort()).toEqual([...exercise.answer].sort());
        expect(exercise.tokens.join(' ')).not.toBe(exercise.answer.join(' '));
        expect(checkOrder(exercise.answer, exercise.answer)).toBe(true);
        expect(checkOrder(exercise.tokens, exercise.answer)).toBe(false);
      }
    }
  });

  it('builds a review lesson from notebook words, even for a single word', () => {
    const [word] = lessonById('u1-l1')!.words;
    const review = buildReviewLesson([word!], 'review-1');
    expect(review.length).toBe(2);
    expect(review[0]!.kind).toBe('choose');
    expect(buildLesson([], 'empty')).toEqual([]);
  });

  it('blanks out a word case-insensitively and tokenises a sentence', () => {
    expect(blankOut('Consequently, prices rose.', 'consequently')).toBe('____, prices rose.');
    expect(blankOut('Nothing here.', 'absent')).toBeNull();
    expect(sentenceTokens('  one  two\tthree ')).toEqual(['one', 'two', 'three']);
  });

  it('forgives one typo in a long word but not in a short one', () => {
    expect(checkTyped('deadline', 'deadline')).toEqual({ correct: true, almost: false });
    expect(checkTyped('  DEADLINE ', 'deadline')).toEqual({ correct: true, almost: false });
    expect(checkTyped('deadlin', 'deadline')).toEqual({ correct: true, almost: true });
    expect(checkTyped('dedline', 'deadline')).toEqual({ correct: true, almost: true });
    expect(checkTyped('rely', 'rent')).toEqual({ correct: false, almost: false });
    expect(checkTyped('rant', 'rent')).toEqual({ correct: false, almost: false });
    expect(checkTyped('', 'rent')).toEqual({ correct: false, almost: false });
  });

  it('tallies a lesson and lists each missed word once', () => {
    const score = scoreLesson([
      { terms: ['a'], firstTryCorrect: true },
      { terms: ['b'], firstTryCorrect: false },
      { terms: ['b', 'c'], firstTryCorrect: false },
      { terms: ['d'], firstTryCorrect: true },
    ]);
    expect(score).toEqual({ correct: 2, total: 4, mistakes: ['b', 'c'] });
  });
});

describe('Leitner review boxes', () => {
  it('moves a remembered word up and schedules it later', () => {
    expect(nextLeitner(0, true)).toEqual({ box: 1, days: LEITNER_DAYS[1] });
    expect(nextLeitner(3, true)).toEqual({ box: 4, days: LEITNER_DAYS[4] });
  });
  it('caps at the top box', () => {
    expect(nextLeitner(5, true)).toEqual({ box: 5, days: LEITNER_DAYS[5] });
  });
  it('drops a forgotten word one box and brings it back now', () => {
    expect(nextLeitner(3, false)).toEqual({ box: 2, days: 0 });
    expect(nextLeitner(0, false)).toEqual({ box: 0, days: 0 });
  });
});
