import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LEARN_BANDS,
  LEARN_BAND_LABELS,
  LESSON_KIND_LABELS,
  bandBelow,
  bandIsOpen,
  openPositionCount,
  streakAlive,
  type CatalogueResponse,
  type CatalogueUnit,
  type DailyWordsResult,
  type LearnBand,
  type LearnOverview,
} from '@shared/learn';
import { useAsync } from '../../hooks/useAsync';
import { Icon, type IconName } from '../../components/Icon';
import { Stars } from '../../components/learn/Stars';
import { Button, Loading, Modal, Notice, useToast } from '../../components/ui';
import { describeError } from '../../lib/api';
import { learnApi, localDay } from '../../lib/learn-api';
import { canSpeak, speak } from '../../lib/speech';

type NodeState = 'done' | 'current' | 'open' | 'locked';

/** M, T, W… for a YYYY-MM-DD day, read as a calendar date so the time zone cannot shift it. */
function weekdayInitial(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return '';
  return new Date(year, month - 1, date).toLocaleDateString('en', { weekday: 'narrow' });
}

const WAVE = [0, 38, 64, 38, 0, -38, -64, -38];

/** A lesson as the catalogue sends it, in path order within its band. */
type PathLesson = CatalogueUnit['lessons'][number];

/**
 * Learn: the daily path.
 *
 * A column of lessons that unlock one after another inside a band, with a band
 * strip across the top, XP, a daily streak and a daily goal, today's AI words
 * and a review of due words beside it. The lessons are short (about ten
 * exercises, two or three minutes).
 *
 * The path comes from the catalogue API rather than the bundle, so an
 * administrator can publish lessons at any band without shipping a new client.
 */
export function LearnPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const overview = useAsync<LearnOverview>(() => learnApi.overview(), []);
  const [band, setBand] = useState<LearnBand | null>(null);
  const catalogue = useAsync<CatalogueResponse>(() => learnApi.catalogue(band ?? undefined), [band]);
  const [daily, setDaily] = useState<DailyWordsResult | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  // Words the learner has marked as already known: skipped from the daily list, kept for redo.
  const [knownWords, setKnownWords] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('aieo.word-known') ?? '[]'));
    } catch {
      return new Set<string>();
    }
  });
  const [hideKnown, setHideKnown] = useState(false);
  const toggleKnown = (term: string) => {
    setKnownWords((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      try {
        localStorage.setItem('aieo.word-known', JSON.stringify([...next]));
      } catch {
        // Private mode: the mark just won't persist.
      }
      return next;
    });
  };
  const [bandOpenModal, setBandOpenModal] = useState(false);
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

  const bands = catalogue.data?.bands ?? [];
  const selectedBand = catalogue.data?.selected.band ?? null;
  const selectedLabel = catalogue.data?.selected.label ?? '';

  // A band is finished when every lesson in it has been done at least once.
  const completeBands = useMemo(
    () => bands.filter((item) => item.lessonCount > 0 && item.completedCount >= item.lessonCount).map((item) => item.band),
    [bands],
  );

  const path = useMemo<PathLesson[]>(
    () =>
      (catalogue.data?.selected.units ?? []).flatMap((unit) => unit.lessons),
    [catalogue.data],
  );

  const isOpen = selectedBand === null || bandIsOpen(selectedBand, profile?.band ?? 5, completeBands);
  const completedPositions = path.filter((lesson) => (progress[lesson.id]?.completions ?? 0) > 0).map((lesson) => lesson.position);
  const currentIndex = Math.max(0, Math.min(path.length - 1, openPositionCount(completedPositions, path.length) - 1));

  const stateOf = (lesson: PathLesson, index: number): NodeState => {
    if (!isOpen || path.length === 0) return 'locked';
    if (index > currentIndex) return 'locked';
    if ((progress[lesson.id]?.completions ?? 0) > 0 && index !== currentIndex) return 'done';
    if (index === currentIndex) return 'current';
    return 'open';
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

  const chooseBand = async (next: LearnBand) => {
    try {
      await learnApi.setBand(next);
      setBandOpenModal(false);
      setBand(next);
      await overview.reload();
      toast.push(`Band set to ${next.toFixed(1)} · ${LEARN_BAND_LABELS[next]}.`, 'success');
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
  const totalLessons = bands.reduce((total, item) => total + item.lessonCount, 0);
  const doneCount = bands.reduce((total, item) => total + item.completedCount, 0);
  const blockingBand = selectedBand !== null ? bandBelow(selectedBand) : null;

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
                  <span className="learn-week__bar">
                    <i style={{ height: `${Math.max(14, Math.round((item.xp / maxWeek) * 100))}%` }} className={item.xp > 0 ? 'on' : ''} />
                  </span>
                  <small>{weekdayInitial(item.day)}</small>
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
              <h2>Study plan</h2>
              <Link className="learn-card__link" to="/learn/plan">
                Open
                <Icon name="arrowRight" size={13} />
              </Link>
            </header>
            <p className="muted small">
              A dated route from your current band to the one you want, built from your recent test scores.
            </p>
            <Button size="sm" block loading={planBusy} onClick={() => void makeRevisionLesson(navigate, setPlanBusy, toast.push)}>
              <Icon name="sparkle" size={13} />
              Lesson from my mistakes
            </Button>
          </section>

          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Today’s words</h2>
              <div className="row">
                <Button size="sm" variant="ghost" onClick={() => setHideKnown((value) => !value)}>
                  <Icon name="eye" size={13} />
                  {hideKnown ? 'Showing all' : 'Hide known'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void moreWords()} loading={dailyBusy}>
                  <Icon name="plus" size={13} />5 more
                </Button>
              </div>
            </header>
            {dailyBusy && !daily ? (
              <p className="muted small">Choosing words for your band…</p>
            ) : daily && daily.words.length > 0 ? (
              <ul className="daily-words">
                {daily.words
                  .filter((word) => !hideKnown || !knownWords.has(word.term))
                  .slice(0, 6)
                  .map((word) => {
                    const isKnown = knownWords.has(word.term);
                    return (
                      <li key={word.id} style={isKnown ? { opacity: 0.5 } : undefined}>
                        <div className="daily-words__top">
                          <b>{word.term}</b>
                          {word.pos ? <span className="muted tiny">{word.pos}</span> : null}
                          {canSpeak() ? (
                            <button type="button" className="vocab-item__speak" onClick={() => speak(word.term)} aria-label={`Hear “${word.term}”`}>
                              <Icon name="play" size={10} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="vocab-item__speak"
                            onClick={() => toggleKnown(word.term)}
                            aria-label={isKnown ? `Mark “${word.term}” as still learning` : `Mark “${word.term}” as known`}
                            title={isKnown ? 'Still learning' : 'I know this'}
                          >
                            <Icon name={isKnown ? 'rotate' : 'check'} size={10} />
                          </button>
                        </div>
                        <span className="daily-words__vi">{word.meaningVi || word.meaning}</span>
                      </li>
                    );
                  })}
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
              <h2>Your band</h2>
              <Button size="sm" variant="ghost" onClick={() => setBandOpenModal(true)}>
                Change
              </Button>
            </header>
            <p className="learn-level">
              <b>
                {profile.band.toFixed(1)} · {LEARN_BAND_LABELS[profile.band]}
              </b>
              <span className="muted small">
                {profile.bandSource === 'CHOSEN'
                  ? 'Chosen by you.'
                  : profile.bandSource === 'ESTIMATED'
                    ? `Picked from your recent test bands (about ${profile.startBand?.toFixed(1)}).`
                    : 'A starting point. Take a practice test or change it yourself.'}
              </span>
            </p>
            <p className="muted tiny">
              {doneCount} of {totalLessons} lessons finished.
            </p>
          </section>
        </aside>

        <section className="learn__path" aria-label="Lesson path">
          <nav className="band-strip" aria-label="Choose a band">
            {bands.map((item) => {
              const on = item.band === selectedBand;
              const empty = item.lessonCount === 0;
              const finished = item.lessonCount > 0 && item.completedCount >= item.lessonCount;
              return (
                <button
                  key={item.band}
                  type="button"
                  className={`band-chip${on ? ' is-on' : ''}${empty ? ' is-empty' : ''}${finished ? ' is-done' : ''}`}
                  onClick={() => {
                    setBand(item.band);
                    setOpenLesson(null);
                  }}
                  aria-current={on ? 'true' : undefined}
                  title={LEARN_BAND_LABELS[item.band]}
                >
                  <b>{item.band.toFixed(1)}</b>
                  <span>
                    {empty ? 'no lessons yet' : `${item.completedCount}/${item.lessonCount}`}
                  </span>
                </button>
              );
            })}
          </nav>

          {catalogue.loading && !catalogue.data ? <Loading label="Loading the path…" /> : null}
          {catalogue.error && !catalogue.data ? (
            <Notice tone="danger" title="The path could not be loaded">
              {catalogue.error}
            </Notice>
          ) : null}

          {!isOpen ? (
            <div className="unit unit--locked">
              <header className="unit__head">
                <div>
                  <p className="unit__kicker">
                    Band {selectedBand?.toFixed(1)} · {selectedLabel}
                  </p>
                  <h2>
                    <Icon name="lock" size={15} strokeWidth={2.4} /> Locked
                  </h2>
                  <p>
                    Finish band {blockingBand?.toFixed(1)} to open this band, or set your own band to
                    jump straight here.
                  </p>
                </div>
              </header>
              <Button variant="primary" onClick={() => setBandOpenModal(true)}>
                Change your band
              </Button>
            </div>
          ) : (
            catalogue.data?.selected.units.map((unit, unitIndex) => {
              const lessons = path.filter((lesson) => lesson.unitKey === unit.unitKey);
              const finished = lessons.filter((lesson) => (progress[lesson.id]?.completions ?? 0) > 0).length;
              const unitDone = lessons.length > 0 && finished === lessons.length;
              const unitLocked = lessons.length > 0 && lessons.every((lesson) => stateOf(lesson, path.indexOf(lesson)) === 'locked');
              return (
                <div key={unit.unitKey} className={`unit unit--c${unitIndex % 4}${unitLocked ? ' unit--locked' : ''}`}>
                  <header className="unit__head">
                    <div>
                      <p className="unit__kicker">Band {selectedBand?.toFixed(1)}</p>
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
                      const index = path.indexOf(lesson);
                      const state = stateOf(lesson, index);
                      const item = progress[lesson.id];
                      const offset = WAVE[index % WAVE.length]!;
                      const open = openLesson === lesson.id;
                      const icon: IconName = state === 'done' ? 'check' : state === 'locked' ? 'lock' : 'play';
                      const previous = path[index - 1];
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
                            <em className="node-kind">{LESSON_KIND_LABELS[lesson.kind]}</em>
                          </div>
                          {open ? (
                            <div className="node-pop" role="dialog" aria-label={lesson.title}>
                              <h3>{lesson.title}</h3>
                              <p className="muted small">{lesson.blurb}</p>
                              <p className="node-pop__words">{lesson.preview}</p>
                              {state === 'locked' ? (
                                <p className="small">
                                  Finish {previous?.title ?? 'the previous lesson'} to unlock this lesson.
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
            })
          )}

          {isOpen && path.length > 0 ? (
            <p className="learn__end">
              {doneCount >= totalLessons
                ? 'You have finished every lesson. New lessons are added over time.'
                : 'More lessons are added at every band over time.'}
            </p>
          ) : null}
        </section>
      </div>

      <Modal open={bandOpenModal} onClose={() => setBandOpenModal(false)} title="Choose your band">
        <p className="muted small">The path opens at the band you pick, and the AI pitches your daily words to it.</p>
        <div className="level-choices">
          {LEARN_BANDS.map((item) => (
            <button
              key={item}
              type="button"
              className={`level-choice${profile.band === item ? ' is-on' : ''}`}
              onClick={() => void chooseBand(item)}
            >
              <b>{item.toFixed(1)}</b>
              <span>{LEARN_BAND_LABELS[item]}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/**
 * Builds today's revision lesson from the words this learner keeps getting
 * wrong, then opens it.
 *
 * The server keeps one per learner per day and returns the same one for the
 * rest of that day, so pressing the button twice does not produce two lessons.
 */
async function makeRevisionLesson(
  navigate: (to: string) => void,
  setBusy: (busy: boolean) => void,
  push: (message: string, tone?: 'success' | 'info' | 'warning' | 'error') => void,
) {
  setBusy(true);
  try {
    const response = await learnApi.buildPersonalLesson();
    navigate(`/learn/lesson/${response.lessonId}`);
  } catch (cause) {
    push(cause instanceof Error ? cause.message : 'That revision lesson could not be built.', 'error');
  } finally {
    setBusy(false);
  }
}
