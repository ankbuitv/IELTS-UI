import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { lessonById } from '@shared/learn-content';
import { buildLesson, buildReviewLesson } from '@shared/learn-engine';
import { LessonPlayer, useLessonSeed, type LessonFinish } from '../../components/learn/LessonPlayer';
import { Icon } from '../../components/Icon';
import { Loading, Notice } from '../../components/ui';
import { learnApi, type ReviewWord } from '../../lib/learn-api';
import { describeError } from '../../lib/api';

/** A lesson from the path, played full screen. */
export function LessonPage() {
  const { lessonId = '' } = useParams();
  const navigate = useNavigate();
  const lesson = lessonById(lessonId);
  const [seed, restart] = useLessonSeed(lessonId);
  const exercises = useMemo(() => (lesson ? buildLesson(lesson.words, seed) : []), [lesson, seed]);

  const finish = useCallback(
    async (score: { correct: number; total: number; mistakes: string[] }): Promise<LessonFinish> => {
      const result = await learnApi.completeLesson({ lessonId, ...score });
      const lines: string[] = [];
      if (result.streakIncreased) lines.push(`Streak: ${result.streak} day${result.streak === 1 ? '' : 's'} in a row.`);
      if (result.goalReached) lines.push('You reached today’s XP goal.');
      if (result.wordsSaved > 0) lines.push(`${result.wordsSaved} word${result.wordsSaved === 1 ? '' : 's'} you missed went to your notebook for review.`);
      if (result.firstCompletion) lines.push('The next lesson is unlocked.');
      return { xpGained: result.xpGained, stars: result.stars, lines };
    },
    [lessonId],
  );

  if (!lesson) return <Navigate to="/learn" replace />;
  return (
    <LessonPlayer
      key={seed}
      title={`${lesson.unitTitle} · ${lesson.title}`}
      exercises={exercises}
      onExit={() => navigate('/learn')}
      onFinish={finish}
      onRestart={restart}
    />
  );
}

/** A review of the notebook words that are due, played as a lesson. */
export function ReviewPage() {
  const navigate = useNavigate();
  const [words, setWords] = useState<ReviewWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, restart] = useLessonSeed('review');

  const load = useCallback(() => {
    setWords(null);
    learnApi
      .reviewWords()
      .then((result) => setWords(result.words))
      .catch((loadError) => setError(describeError(loadError)));
  }, []);
  useEffect(() => load(), [load]);

  const exercises = useMemo(
    () =>
      words
        ? buildReviewLesson(
            words.map((word) => ({
              term: word.term,
              pos: word.pos || 'word',
              meaning: word.meaning,
              vi: word.meaningVi,
              example: word.example || `${word.term}.`,
            })),
            seed,
          )
        : [],
    [words, seed],
  );

  const finish = useCallback(
    async (score: { mistakes: string[] }): Promise<LessonFinish> => {
      const missed = new Set(score.mistakes.map((term) => term.toLowerCase()));
      const result = await learnApi.completeReview((words ?? []).map((word) => ({ id: word.id, correct: !missed.has(word.term.toLowerCase()) })));
      const lines = [`${result.reviewed} word${result.reviewed === 1 ? '' : 's'} reviewed. Words you knew will come back later; the others tomorrow.`];
      if (result.streakIncreased) lines.push(`Streak: ${result.streak} days in a row.`);
      if (result.goalReached) lines.push('You reached today’s XP goal.');
      return { xpGained: result.xpGained, lines };
    },
    [words],
  );

  if (error) {
    return (
      <div className="lesson">
        <div className="lesson__end">
          <Notice tone="danger">{error}</Notice>
          <Link className="btn" to="/learn">
            Back to Learn
          </Link>
        </div>
      </div>
    );
  }
  if (!words) return <Loading label="Collecting your words…" />;
  if (words.length === 0) {
    return (
      <div className="lesson">
        <div className="lesson__end">
          <div className="lesson__end-mark" aria-hidden="true">
            <Icon name="check" size={34} strokeWidth={3.2} />
          </div>
          <h1>Nothing to review</h1>
          <p className="muted">Every word in your notebook is up to date. New words arrive each day.</p>
          <Link className="btn btn--primary btn--lg" to="/learn">
            Back to Learn
          </Link>
        </div>
      </div>
    );
  }
  return (
    <LessonPlayer
      key={seed}
      title="Review"
      exercises={exercises}
      onExit={() => navigate('/learn')}
      onFinish={finish}
      onRestart={() => {
        restart();
        load();
      }}
    />
  );
}
