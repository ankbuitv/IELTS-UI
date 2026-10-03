import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LEARN_LEVEL_LABELS, LEARN_LEVELS, streakAlive, type DailyWordsResult, type LearnLevel, type LearnOverview } from '@shared/learn';
import { LESSONS, UNITS, unlockedThrough, type FlatLesson } from '@shared/learn-content';
import { useAsync } from '../../hooks/useAsync';
import { Icon, type IconName } from '../../components/Icon';
import { Stars } from '../../components/learn/Stars';
import { Button, Loading, Modal, Notice, useToast } from '../../components/ui';
import { describeError } from '../../lib/api';
import { learnApi, localDay } from '../../lib/learn-api';
import { canSpeak, speak } from '../../lib/speech';

type NodeState = 'done' | 'current' | 'open' | 'locked';

const WAVE = [0, 38, 64, 38, 0, -38, -64, -38];

/**
 * Learn: the daily path.
 *
 * A column of lessons that unlock one after another, with XP, a daily streak
 * and a daily goal on top, today's AI words and a review of due words beside
 * it. The lessons are short (about ten exercises, two or three minutes).
 */
export function LearnPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const overview = useAsync<LearnOverview>(() => learnApi.overview(), []);
  const [daily, setDaily] = useState<DailyWordsResult | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const [levelOpen, setLevelOpen] = useState(false);
  const askedForWords = useRef(false);

  const data = overview.data;

  // Today's words appear by themselves the first time the path is opened each day.
  useEffect(() => {
    if (!data || askedForWords.current) return;
    askedForWords.current = true;
    setDailyBusy(true);
    learnApi
      .dailyWords()
      .then((result) => {
        setDaily(result);
        if (result.added > 0) void overview.reload();
      })
      .catch(() => setDaily(null))
      .finally(() => setDailyBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const today = localDay();
  const profile = data?.profile;
  const progress = data?.progress ?? {};

  const { currentIndex, furthest } = useMemo(() => {
    let best = -1;
    for (const lesson of LESSONS) if ((progress[lesson.id]?.completions ?? 0) > 0) best = Math.max(best, lesson.index);
    const unlocked = Math.min(LESSONS.length - 1, unlockedThrough(best, profile?.level ?? 5));
    return { currentIndex: unlocked, furthest: best };
  }, [progress, profile?.level]);

  const stateOf = (lesson: FlatLesson): NodeState => {
    if ((progress[lesson.id]?.completions ?? 0) > 0 && lesson.index !== currentIndex) return 'done';
    if (lesson.index === currentIndex) return 'current';
    if (lesson.index < currentIndex) return 'open';
    return 'locked';
  };

  const moreWords = async () => {
    setDailyBusy(true);
    try {
      const result = await learnApi.dailyWords(true);
      setDaily(result);
      void overview.reload();
      if (result.added === 0) toast.push('No new words could be added right now.', 'warning');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    } finally {
      setDailyBusy(false);
    }
  };

  const chooseLevel = async (level: LearnLevel) => {
    try {
      await learnApi.setLevel(level);
      setLevelOpen(false);
      await overview.reload();
      toast.push(`Level set to ${LEARN_LEVEL_LABELS[level]}.`, 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  if (overview.loading && !data) return <Loading label="Loading your path…" />;
  if (overview.error && !data) {
    return (
      <Notice tone="danger" title="The learning path could not be loaded">
        {overview.error}
      </Notice>
    );
  }
  if (!data || !profile) return null;

  const goalPercent = Math.min(100, Math.round((profile.todayXp / Math.max(1, profile.dailyGoalXp)) * 100));
  const alive = streakAlive(profile.lastActiveDay, today);
  const activeToday = profile.lastActiveDay === today;
  const maxWeek = Math.max(1, ...data.week.map((item) => item.xp));
  const doneCount = LESSONS.filter((lesson) => (progress[lesson.id]?.completions ?? 0) > 0).length;

  return (
    <div className="learn">
      <section className="learn__stats" aria-label="Your progress">
        <div className={`learn-stat learn-stat--fire${alive && profile.streak > 0 ? ' is-hot' : ''}`}>
          <span className="learn-stat__icon">
            <Icon name="flame" size={26} filled />
          </span>
          <div>
            <b>{alive ? profile.streak : 0}</b>
            <span>{alive && profile.streak > 0 ? (activeToday ? 'day streak' : 'day streak · practise today') : 'Start a streak today'}</span>
          </div>
        </div>
        <div className="learn-stat learn-stat--xp">
          <span className="learn-stat__icon">
            <Icon name="bolt" size={26} filled />
          </span>
          <div>
            <b>{profile.xp}</b>
            <span>total XP</span>
          </div>
        </div>
        <div className="learn-stat learn-stat--goal">
          <div className="learn-goal">
            <div className="learn-goal__head">
              <span>Daily goal</span>
              <b>
                {profile.todayXp} / {profile.dailyGoalXp} XP
              </b>
            </div>
            <div className="learn-goal__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPercent} aria-label="Daily goal">
              <i style={{ width: `${goalPercent}%` }} />
            </div>
            <div className="learn-week" aria-hidden="true">
              {data.week.map((item) => (
                <span key={item.day} title={`${item.day}: ${item.xp} XP`} className={item.day === today ? 'is-today' : ''}>
                  <i style={{ height: `${Math.max(8, Math.round((item.xp / maxWeek) * 100))}%` }} className={item.xp > 0 ? 'on' : ''} />
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="learn__grid">
        <aside className="learn__today" aria-label="Today">
          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Today’s words</h2>
              <Button size="sm" variant="ghost" onClick={() => void moreWords()} loading={dailyBusy}>
                <Icon name="plus" size={13} />5 more
              </Button>
            </header>
            {dailyBusy && !daily ? (
              <p className="muted small">Choosing words for your level…</p>
            ) : daily && daily.words.length > 0 ? (
              <ul className="daily-words">
                {daily.words.slice(0, 6).map((word) => (
                  <li key={word.id}>
                    <div className="daily-words__top">
                      <b>{word.term}</b>
                      {word.pos ? <span className="muted tiny">{word.pos}</span> : null}
                      {canSpeak() ? (
                        <button type="button" className="vocab-item__speak" onClick={() => speak(word.term)} aria-label={`Hear “${word.term}”`}>
                          <Icon name="play" size={10} />
                        </button>
                      ) : null}
                    </div>
                    <span className="daily-words__vi">{word.meaningVi || word.meaning}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">New words are added here each day. They are saved to your notebook automatically.</p>
            )}
            <Link className="learn-card__link" to="/vocabulary">
              Open notebook <Icon name="arrowRight" size={13} />
            </Link>
          </section>

          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Review</h2>
              {data.dueWords > 0 ? <span className="learn-card__count">{data.dueWords}</span> : null}
            </header>
            <p className="muted small">
              {data.dueWords > 0
                ? `${data.dueWords} word${data.dueWords === 1 ? ' is' : 's are'} due. A short review keeps them from fading.`
                : 'Nothing is due. Words you save will come back here on a schedule.'}
            </p>
            <Button variant="primary" block disabled={data.dueWords === 0} onClick={() => navigate('/learn/review')}>
              Start review
            </Button>
          </section>

          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Your level</h2>
              <Button size="sm" variant="ghost" onClick={() => setLevelOpen(true)}>
                Change
              </Button>
            </header>
            <p className="learn-level">
              <b>{LEARN_LEVEL_LABELS[profile.level]}</b>
              <span className="muted small">
                {profile.levelSource === 'CHOSEN'
                  ? 'Chosen by you.'
                  : profile.levelSource === 'ESTIMATED'
                    ? `Picked from your recent bands (about ${profile.startBand?.toFixed(1)}).`
                    : 'A starting point. Take a practice test or change it yourself.'}
              </span>
            </p>
            <p className="muted tiny">
              {doneCount} of {LESSONS.length} lessons finished.
            </p>
          </section>
        </aside>

        <section className="learn__path" aria-label="Lesson path">
          {UNITS.map((unit, unitIndex) => {
            const lessons = LESSONS.filter((lesson) => lesson.unitId === unit.id);
            const unitDone = lessons.every((lesson) => (progress[lesson.id]?.completions ?? 0) > 0);
            const finished = lessons.filter((lesson) => (progress[lesson.id]?.completions ?? 0) > 0).length;
            const unitLocked = lessons.every((lesson) => stateOf(lesson) === 'locked');
            return (
              <div key={unit.id} className={`unit unit--c${unitIndex % 4}${unitLocked ? ' unit--locked' : ''}`}>
                <header className="unit__head">
                  <div>
                    <p className="unit__kicker">
                      Unit {unit.id.slice(1)} · {unit.band}
                    </p>
                    <h2>{unit.title}</h2>
                    <p>{unit.blurb}</p>
                  </div>
                  {unitDone ? (
                    <span className="unit__done">
                      <Icon name="check" size={14} strokeWidth={3} /> Complete
                    </span>
                  ) : (
                    <span className="unit__count">
                      {unitLocked ? <Icon name="lock" size={13} strokeWidth={2.4} /> : null}
                      {finished}/{lessons.length}
                    </span>
                  )}
                </header>
                <ol className="unit__nodes">
                  {lessons.map((lesson) => {
                    const state = stateOf(lesson);
                    const item = progress[lesson.id];
                    const offset = WAVE[lesson.index % WAVE.length]!;
                    const open = openLesson === lesson.id;
                    const icon: IconName = state === 'done' ? 'check' : state === 'locked' ? 'lock' : 'play';
                    return (
                      <li key={lesson.id} className={`node-row${state === 'locked' ? ' node-row--locked' : ''}`} style={{ '--offset': `${offset}px` } as React.CSSProperties}>
                        <div className="node-wrap">
                          {state === 'current' ? <span className="node-start">Start</span> : null}
                          <button
                            type="button"
                            className={`node node--${state}`}
                            aria-expanded={open}
                            aria-label={`${lesson.title}, ${state === 'locked' ? 'locked' : state === 'done' ? 'finished' : 'available'}`}
                            onClick={() => setOpenLesson(open ? null : lesson.id)}
                          >
                            <Icon name={icon} size={28} strokeWidth={state === 'done' ? 3.2 : 2.2} filled={state === 'current'} />
                          </button>
                          {item && item.completions > 0 ? <Stars value={item.stars} size={13} /> : null}
                        </div>
                        <div className="node-label">
                          <b>{lesson.title}</b>
                          <span>{lesson.blurb}</span>
                        </div>
                        {open ? (
                          <div className="node-pop" role="dialog" aria-label={lesson.title}>
                            <h3>{lesson.title}</h3>
                            <p className="muted small">{lesson.blurb}</p>
                            <p className="node-pop__words">{lesson.words.map((word) => word.term).join(' · ')}</p>
                            {state === 'locked' ? (
                              <p className="small">
                                Finish {LESSONS[Math.max(0, lesson.index - 1)]?.title ?? 'the previous lesson'} to unlock this lesson.
                              </p>
                            ) : (
                              <Button variant="primary" block onClick={() => navigate(`/learn/lesson/${lesson.id}`)}>
                                {state === 'done' ? 'Practise again' : 'Start lesson'}
                                <span className="node-pop__xp">+{item?.completions ? '~7' : '~20'} XP</span>
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
          <p className="learn__end">
            {furthest >= LESSONS.length - 1
              ? 'You have finished every lesson. New words keep arriving every day.'
              : 'More lessons are added over time.'}
          </p>
        </section>
      </div>

      <Modal open={levelOpen} onClose={() => setLevelOpen(false)} title="Choose your level">
        <p className="muted small">The path starts at the first lesson of the level you pick, and the AI pitches your daily words to it.</p>
        <div className="level-choices">
          {LEARN_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={`level-choice${profile.level === level ? ' is-on' : ''}`}
              onClick={() => void chooseLevel(level)}
            >
              <b>{LEARN_LEVEL_LABELS[level]}</b>
              <span>{UNITS.find((unit) => unit.level === level)?.band}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
