import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { LessonPlayPayload, LessonWord } from '@shared/learn';
import { buildLessonFromPayload, buildReviewLesson } from '@shared/learn-engine';
import { LessonPlayer, useLessonSeed, type LessonFinish } from '../../components/learn/LessonPlayer';
import { Icon } from '../../components/Icon';
import { Loading, Notice } from '../../components/ui';
import { learnApi, type ReviewWord } from '../../lib/learn-api';
import { describeError } from '../../lib/api';

function learnReturnPath(value: string | null): string {
  if (value === '/learn' || value === '/learn/plan') return value;
  if (value?.startsWith('/learn?') || value?.startsWith('/learn/everyday')) return value;
  return '/learn';
}

/** A lesson from the path, played full screen. */
export function LessonPage() {
  const { lessonId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = learnReturnPath(searchParams.get('returnTo'));
  const planItemId = searchParams.get('planItem');
  const closingQuote = searchParams.get('quote')?.slice(0, 240);
  const [seed, restart] = useLessonSeed(lessonId);
  const [lesson, setLesson] = useState<LessonPlayPayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lessons live in the catalogue now, so the body is fetched rather than read
  // from the bundle. The seed stays local, so restarting a lesson still gives a
  // fresh but reproducible set of exercises without another request. State is
  // only written from the async callbacks; while a new lesson is in flight the
  // previous one is ignored by the `lesson.id === lessonId` guard below, so no
  // synchronous reset is needed here.
  useEffect(() => {
    let cancelled = false;
    learnApi
      .lesson(lessonId)
      .then((result) => {
        if (cancelled) return;
        setLesson(result.lesson);
        setMissing(false);
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        if (describeError(cause).toLowerCase().includes('does not exist')) setMissing(true);
        else setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const exercises = useMemo(
    () => (lesson && lesson.id === lessonId ? buildLessonFromPayload(lesson.payload, seed, { pool: lesson.pool }) : []),
    [lesson, seed, lessonId],
  );

  const finish = useCallback(
    async (score: { correct: number; total: number; mistakes: string[] }): Promise<LessonFinish> => {
      const result = await learnApi.completeLesson({ lessonId, ...score });
      const lines: string[] = [];
      if (planItemId) {
        try { await learnApi.setPlanItem(planItemId, 'DONE'); }
        catch { lines.push('Your lesson is saved, but the Study Plan could not be updated. You can mark it complete from the plan.'); }
      }
      if (result.boosted) lines.push('Double XP was running, so this lesson paid twice.');
      if (result.freezeUsed) lines.push('A streak freeze was spent, and your streak crossed the missed day.');
      if (result.streakIncreased) lines.push(`Streak: ${result.streak} day${result.streak === 1 ? '' : 's'} in a row.`);
      if (result.goalReached) lines.push('You reached today’s XP goal.');
      for (const quest of result.questsClaimed) lines.push(`Quest complete: ${quest.label} — +${quest.coins} coins.`);
      if (result.wordsSaved > 0) lines.push(`${result.wordsSaved} word${result.wordsSaved === 1 ? '' : 's'} you missed went to your notebook for review.`);
      if (result.firstCompletion) lines.push('The next lesson is unlocked.');
      return { xpGained: result.xpGained, stars: result.stars, coins: result.coinsGained, boosted: result.boosted, lines };
    },
    [lessonId, planItemId],
  );

  if (missing) return <Navigate to={returnTo} replace />;
  if (error) {
    return (
      <div className="lesson">
        <div className="lesson__end">
          <Notice tone="danger">{error}</Notice>
          <Link className="btn" to={returnTo}>
            Back to Learn
          </Link>
        </div>
      </div>
    );
  }
  // A lesson that belongs to the previous id is treated as still loading.
  if (!lesson || lesson.id !== lessonId) return <Loading label="Opening the lesson…" />;
  return (
    <LessonPlayer
      key={seed}
      title={`${lesson.unitTitle} · ${lesson.title}`}
      exercises={exercises}
      videoUrl={lesson.videoUrl}
      legendary={lesson.legendary}
      onExit={() => navigate(returnTo)}
      onFinish={finish}
      onRestart={restart}
      closingQuote={closingQuote}
    />
  );
}

/** A review of the notebook words that are due, played as a lesson. */
export function ReviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = learnReturnPath(searchParams.get('returnTo'));
  const planItemId = searchParams.get('planItem');
  const [words, setWords] = useState<ReviewWord[] | null>(null);
  const [pool, setPool] = useState<LessonWord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [seed, restart] = useLessonSeed('review');

  const load = useCallback(() => {
    setWords(null);
    learnApi
      .reviewWords()
      .then((result) => {
        setWords(result.words);
        setPool(result.pool ?? []);
      })
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
            pool,
          )
        : [],
    [words, seed, pool],
  );

  const finish = useCallback(
    async (score: { mistakes: string[] }): Promise<LessonFinish> => {
      const missed = new Set(score.mistakes.map((term) => term.toLowerCase()));
      const result = await learnApi.completeReview((words ?? []).map((word) => ({ id: word.id, correct: !missed.has(word.term.toLowerCase()) })));
      const lines = [`${result.reviewed} word${result.reviewed === 1 ? '' : 's'} reviewed. Words you knew will come back later; the others tomorrow.`];
      if (planItemId) {
        try { await learnApi.setPlanItem(planItemId, 'DONE'); }
        catch { lines.push('Your review is saved, but the Study Plan could not be updated. You can mark it complete from the plan.'); }
      }
      if (result.boosted) lines.push('Double XP was running, so the review paid twice.');
      if (result.streakIncreased) lines.push(`Streak: ${result.streak} days in a row.`);
      if (result.goalReached) lines.push('You reached today’s XP goal.');
      for (const quest of result.questsClaimed) lines.push(`Quest complete: ${quest.label} — +${quest.coins} coins.`);
      return { xpGained: result.xpGained, coins: result.coinsGained, boosted: result.boosted, lines };
    },
    [words, planItemId],
  );

  if (error) {
    return (
      <div className="lesson">
        <div className="lesson__end">
          <Notice tone="danger">{error}</Notice>
          <Link className="btn" to={returnTo}>
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
          <Link className="btn btn--primary btn--lg" to={returnTo}>
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
      onExit={() => navigate(returnTo)}
      onFinish={finish}
      onRestart={() => {
        restart();
        load();
      }}
    />
  );
}
