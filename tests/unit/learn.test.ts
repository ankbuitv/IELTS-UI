import { describe, expect, it } from 'vitest';
import { LESSONS, UNITS, WORD_BANK, findBankWord, lessonById } from '../../src/shared/learn-content';
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
  type Exercise,
} from '../../src/shared/learn-engine';
import {
  LEARN_BANDS,
  LEARN_BAND_LABELS,
  bandBelow,
  bandForEstimate,
  bandIndex,
  bandIsOpen,
  isLearnBand,
  isPlausibleDay,
  lessonXp,
  nextStreak,
  openPositionCount,
  starsFor,
  streakAlive,
  stretchBand,
  utcDay,
} from '../../src/shared/learn';
import { LEITNER_DAYS, nextLeitner } from '../../src/shared/vocabulary';

describe('learning path content', () => {
  it('covers every half band from 4.0 to 8.0', () => {
    const bandsInContent = new Set(UNITS.map((unit) => unit.band));
    for (const band of LEARN_BANDS) {
      expect(bandsInContent.has(band), `band ${band.toFixed(1)}`).toBe(true);
    }
    // The array is in band order, so the path reads bottom to top.
    const unitBands = UNITS.map((unit) => unit.band);
    expect(unitBands).toEqual([...unitBands].sort((a, b) => a - b));
  });

  it('has four lessons of six words in every unit', () => {
    expect(LESSONS.length).toBe(UNITS.length * 4);
    for (const unit of UNITS) {
      expect(unit.lessons, unit.id).toHaveLength(4);
      for (const lesson of unit.lessons) expect(lesson.words, lesson.id).toHaveLength(6);
    }
  });

  it('numbers lessons from zero inside each band, in path order', () => {
    for (const band of LEARN_BANDS) {
      const atBand = LESSONS.filter((lesson) => lesson.band === band);
      expect(
        atBand.map((lesson) => lesson.position),
        `band ${band.toFixed(1)}`,
      ).toEqual(atBand.map((_, index) => index));
    }
  });

  it('uses unique lesson ids and unique words', () => {
    expect(new Set(LESSONS.map((lesson) => lesson.id)).size).toBe(LESSONS.length);
    const terms = WORD_BANK.map((word) => word.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('gives every word a distinct meaning, so a multiple-choice option is never ambiguous', () => {
    const meanings = WORD_BANK.map((word) => word.meaning.trim().toLowerCase());
    expect(new Set(meanings).size, WORD_BANK.filter((word, index) => meanings.indexOf(word.meaning.trim().toLowerCase()) !== index).map((word) => word.term).join(', ')).toBe(meanings.length);
  });

  it('writes every example so it contains the word exactly once (a fill-in-the-blank needs it)', () => {
    for (const word of WORD_BANK) {
      const haystack = word.example.toLowerCase();
      expect(haystack, word.term).toContain(word.term.toLowerCase());
      expect(haystack.indexOf(word.term.toLowerCase()), word.term).toBe(haystack.lastIndexOf(word.term.toLowerCase()));
      expect(word.meaning.length, word.term).toBeGreaterThan(5);
      expect(word.vi.length, word.term).toBeGreaterThan(1);
    }
  });

  it('survives the JSON round trip the catalogue stores it as', () => {
    for (const lesson of LESSONS) {
      const stored = JSON.parse(JSON.stringify({ words: lesson.words }));
      expect(stored.words, lesson.id).toHaveLength(6);
      for (const word of stored.words) {
        for (const field of ['term', 'pos', 'meaning', 'vi', 'example']) {
          expect(typeof word[field], `${lesson.id} ${field}`).toBe('string');
        }
      }
    }
  });

  it('finds lessons and bank words by id and term', () => {
    expect(lessonById('u3-l2')?.title).toBe('Cause and effect');
    expect(lessonById('u9-l4')?.band).toBe(8);
    expect(lessonById('nope')).toBeNull();
    expect(findBankWord('  Mitigate ')?.vi).toBe('giảm nhẹ');
    expect(findBankWord('seminal')?.band).toBe(8);
  });
});

describe('the band ladder', () => {
  it('runs from 4.0 to 8.0 in half bands and labels every rung', () => {
    expect(LEARN_BANDS).toEqual([4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8]);
    for (const band of LEARN_BANDS) {
      expect(LEARN_BAND_LABELS[band].length, `${band}`).toBeGreaterThan(2);
      expect(isLearnBand(band)).toBe(true);
    }
    expect(isLearnBand(5.25)).toBe(false);
    expect(isLearnBand(null)).toBe(false);
  });

  it('snaps an estimate to the nearest rung, defaulting to the middle and clamping at the ends', () => {
    expect(bandForEstimate(null)).toBe(5);
    expect(bandForEstimate(undefined)).toBe(5);
    expect(bandForEstimate(Number.NaN)).toBe(5);
    expect(bandForEstimate(3.5)).toBe(4);
    expect(bandForEstimate(4.2)).toBe(4);
    expect(bandForEstimate(4.3)).toBe(4.5);
    expect(bandForEstimate(6.24)).toBe(6);
    expect(bandForEstimate(6.25)).toBe(6.5);
    expect(bandForEstimate(7)).toBe(7);
    expect(bandForEstimate(8.5)).toBe(8);
    for (const band of LEARN_BANDS) expect(bandForEstimate(band)).toBe(band);
  });

  it('stretches new material one rung up, never past the top', () => {
    expect(stretchBand(4)).toBe(4.5);
    expect(stretchBand(6.5)).toBe(7);
    expect(stretchBand(8)).toBe(8);
    expect(bandIndex(bandBelow(5)!)).toBe(bandIndex(5) - 1);
    expect(bandBelow(4)).toBeNull();
  });

  it('opens lessons up to one past the furthest finished one', () => {
    expect(openPositionCount([], 4)).toBe(1);
    expect(openPositionCount([0], 4)).toBe(2);
    expect(openPositionCount([0, 1, 2], 4)).toBe(4);
    expect(openPositionCount([0, 1, 2, 3], 4)).toBe(4); // all done, nothing further to open
    expect(openPositionCount([2], 4)).toBe(4); // skipping ahead still opens what came before
    expect(openPositionCount([9, -1], 4)).toBe(1); // positions outside the band are ignored
    expect(openPositionCount([0], 0)).toBe(0);
  });

  it('opens a band at or below the placement, and above it only when the band below is finished', () => {
    expect(bandIsOpen(5, 6, [])).toBe(true);
    expect(bandIsOpen(6, 6, [])).toBe(true);
    expect(bandIsOpen(6.5, 6, [])).toBe(false);
    expect(bandIsOpen(6.5, 6, [6])).toBe(true);
    expect(bandIsOpen(7, 6, [6])).toBe(false); // 6.5 not finished yet
    expect(bandIsOpen(7, 6, [6, 6.5])).toBe(true);
    expect(bandIsOpen(4.5, 4, [])).toBe(false);
  });
});

describe('learn rules', () => {
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

  it('takes its wrong options only from the pool it is given', () => {
    // The catalogue sends the words of the lesson's own band, so a band-4
    // learner never sees a band-8 word as a distractor.
    const lesson = lessonById('u1-l1')!;
    const pool = lessonById('u1-l2')!.words;
    const allowed = new Set([...lesson.words, ...pool].map((word) => word.term.toLowerCase()));
    for (const exercise of buildLesson(lesson.words, 'pool-test', { pool })) {
      if (exercise.kind === 'choose') continue;
      const shown =
        exercise.kind === 'fill' || exercise.kind === 'listen'
          ? exercise.options
          : exercise.kind === 'match'
            ? exercise.pairs.map((pair) => pair.term)
            : [];
      for (const term of shown) expect(allowed.has(term.toLowerCase()), term).toBe(true);
    }
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

  it('takes a review lesson’s wrong options from the pool it is given, not from a built-in bank', () => {
    const [word] = lessonById('u1-l1')!.words;
    const pool = lessonById('u1-l2')!.words;
    const review = buildReviewLesson([word!], 'review-pool', pool);
    const choose = review.find((exercise) => exercise.kind === 'choose') as Extract<Exercise, { kind: 'choose' }>;
    expect(choose.options).toHaveLength(4);
    // A `choose` exercise offers meanings, so the pool is checked by meaning.
    const allowed = new Set([word!, ...pool].map((item) => item.meaning.trim().toLowerCase()));
    for (const option of choose.options) expect(allowed.has(option.toLowerCase()), option).toBe(true);
    // Without a pool there is nothing to choose between, so it degrades rather
    // than inventing options from content the browser no longer carries.
    const bare = buildReviewLesson([word!], 'review-bare');
    const bareChoose = bare.find((exercise) => exercise.kind === 'choose') as Extract<Exercise, { kind: 'choose' }>;
    expect(bareChoose.options).toHaveLength(1);
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
