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
import type { LeaderboardResponse } from '@shared/leaderboard';
import { boostState } from '@shared/shop';
import { useAsync } from '../../hooks/useAsync';
import { Icon, type IconName } from '../../components/Icon';
import { Stars } from '../../components/learn/Stars';
import { Mascot, type MascotMood } from '../../components/learn/Mascot';
import { Confetti, StreakPulse } from '../../components/learn/Effects';
import { DictionaryPanel } from '../../components/learn/DictionaryPanel';
import { Button, Loading, Modal, Notice, useToast } from '../../components/ui';
import { describeError } from '../../lib/api';
import { learnApi, localDay } from '../../lib/learn-api';
import { canSpeak, speak } from '../../lib/speech';
import { sfx } from '../../lib/sfx';

type NodeState = 'done' | 'current' | 'open' | 'locked';

/** M, T, W… for a YYYY-MM-DD day, read as a calendar date so the time zone cannot shift it. */
function weekdayInitial(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  if (!year || !month || !date) return '';
  return new Date(year, month - 1, date).toLocaleDateString('en', { weekday: 'narrow' });
}

/** A lesson as the catalogue sends it, in path order within its band. */
type PathLesson = CatalogueUnit['lessons'][number];

const WAVE = [0, 38, 64, 38, 0, -38, -64, -38];

/**
 * Learn: the daily path.
 *
 * A column of lessons that unlock one after another inside a band, with a band
 * strip across the top, XP, a daily streak, coins and a daily goal, today's AI
 * words, a review of due words and the day's quests beside it.
 *
 * The path comes from the catalogue API rather than the bundle, so an
 * administrator can publish lessons at any band without shipping a new client.
 * Around it, four things were added to give the day a shape: the mascot reacts
 * to how the visitor is doing, the coin balance and the shop make XP spendable,
 * the quest list says what is left today, and the leaderboard preview makes the
 * work visible next to somebody else's.
 */
export function LearnPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const overview = useAsync<LearnOverview>(() => learnApi.overview(), []);
  const [band, setBand] = useState<LearnBand | null>(null);
  const catalogue = useAsync<CatalogueResponse>(() => learnApi.catalogue(band ?? undefined), [band]);
  const board = useAsync<LeaderboardResponse>(() => learnApi.leaderboard('learn', 'week'), []);
  const [daily, setDaily] = useState<DailyWordsResult | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const [clock, setClock] = useState(0);
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
    sfx.play('select');
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
  const announcedQuest = useRef(false);
  const pulseAnnounced = useRef(false);
  const announcedBoost = useRef(false);

  const data = overview.data;
  const today = localDay();

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

  // Quest coins that were settled by this visit: a small ceremony, once.
  useEffect(() => {
    const coins = data?.coinsFromQuests ?? 0;
    if (!data || coins <= 0 || announcedQuest.current) return;
    announcedQuest.current = true;
    sfx.play('dailyGoal');
    setCelebrate((value) => value + 1);
    toast.push(`Daily quest complete — ${coins} coins added to your wallet.`, 'success');
    window.setTimeout(() => sfx.play('coin'), 600);
  }, [data, toast]);

  // A fire sound the first time the path opens on a day that keeps the streak.
  // The pulse ring is drawn from `streakHot` below, so nothing has to be set here.
  useEffect(() => {
    if (!data || pulseAnnounced.current) return;
    pulseAnnounced.current = true;
    if ((data.profile.streak ?? 0) > 0 && data.profile.lastActiveDay === today) sfx.play('streak');
  }, [data, today]);

  // A boost is worth announcing once, when it is switched on from the shop.
  useEffect(() => {
    if (!data || announcedBoost.current) return;
    const boost = boostState(data.profile.xpBoostUntil, new Date());
    if (!boost.active) return;
    announcedBoost.current = true;
    sfx.play('boost');
  }, [data]);

  // The boost label counts down in minutes; tick it every 30 s.
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  void clock;

  const profile = data?.profile;
  const progress = data?.progress ?? {};

  const bands = useMemo(() => catalogue.data?.bands ?? [], [catalogue.data]);
  const selectedBand = catalogue.data?.selected.band ?? null;
  const selectedLabel = catalogue.data?.selected.label ?? '';

  // A band is finished when every lesson in it has been done at least once.
  const completeBands = useMemo(
    () => bands.filter((item) => item.lessonCount > 0 && item.completedCount >= item.lessonCount).map((item) => item.band),
    [bands],
  );

  const path = useMemo<PathLesson[]>(
    () => (catalogue.data?.selected.units ?? []).flatMap((unit) => unit.lessons),
    [catalogue.data],
  );

  const isOpen = selectedBand === null || bandIsOpen(selectedBand, profile?.band ?? 5, completeBands);
  const completedPositions = path.filter((lesson) => (progress[lesson.id]?.completions ?? 0) > 0).map((lesson) => lesson.position);
  const currentIndex = Math.max(0, Math.min(path.length - 1, openPositionCount(completedPositions, path.length) - 1));
  const currentLesson = path[currentIndex];
  const nextLesson = currentLesson && (progress[currentLesson.id]?.completions ?? 0) > 0 ? path[currentIndex + 1] : currentLesson;

  const stateOf = (lesson: PathLesson, index: number): NodeState => {
    if (!isOpen || path.length === 0) return 'locked';
    // A legendary lesson unlocks only once the learner reaches its band in practice.
    if (lesson.legendary && (profile?.band ?? 0) < (selectedBand ?? 0)) return 'locked';
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
      sfx.play(result.added > 0 ? 'coin' : 'error');
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
      sfx.play('unlock');
      toast.push(`Band set to ${next.toFixed(1)} · ${LEARN_BAND_LABELS[next]}.`, 'success');
    } catch (cause) {
      toast.push(describeError(cause), 'error');
    }
  };

  const openNode = (lesson: PathLesson, isOpenNow: boolean) => {
    if (!isOpenNow) {
      sfx.play('error');
    } else {
      sfx.play('select');
    }
    setOpenLesson((previous) => (previous === lesson.id ? null : lesson.id));
  };

  const startLesson = (lessonId: string) => {
    sfx.play('lessonStart');
    navigate(`/learn/lesson/${lessonId}`);
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
  const goalDone = profile.todayXp >= profile.dailyGoalXp;
  const alive = streakAlive(profile.lastActiveDay, today);
  const activeToday = profile.lastActiveDay === today;
  const maxWeek = Math.max(1, ...data.week.map((item) => item.xp));
  const totalLessons = bands.reduce((total, item) => total + item.lessonCount, 0);
  const doneCount = bands.reduce((total, item) => total + item.completedCount, 0);
  const blockingBand = selectedBand !== null ? bandBelow(selectedBand) : null;
  const boost = boostState(profile.xpBoostUntil, new Date());
  const questsDone = data.quests.filter((quest) => quest.claimed).length;
  const mood: MascotMood = goalDone ? 'wow' : !activeToday && alive ? 'wave' : activeToday ? 'happy' : 'idle';
  const streakHot = alive && profile.streak > 0 && activeToday;
  const boardTop = board.data?.rows.slice(0, 3) ?? [];

  return (
    <div className="learn">
      <header className="arena">
        <Confetti burst={celebrate} pieces={36} />
        <div className="arena__mascot">
          {streakHot ? <StreakPulse burst={1} /> : null}
          <Mascot mood={mood} size={172} />
        </div>
        <div className="arena__text">
          <p className="arena__kicker">
            <Icon name="target" size={13} /> Band {profile.band.toFixed(1)} · {LEARN_BAND_LABELS[profile.band]}
          </p>
          <h1>
            {goalDone
              ? 'Goal reached — the rest is a bonus.'
              : activeToday && profile.streak > 0
                ? `${profile.streak} day${profile.streak === 1 ? '' : 's'} in a row. Keep it going.`
                : nextLesson
                  ? `Next up: ${nextLesson.title}`
                  : 'Your path is waiting.'}
          </h1>
          <p className="arena__line">
            {boost.active
              ? `Double XP is running — ${boost.minutesLeft} minutes left to cash in.`
              : goalDone
                ? 'Every extra answer today is worth XP and coins towards the shop.'
                : `${Math.max(0, profile.dailyGoalXp - profile.todayXp)} XP left to hit today's goal of ${profile.dailyGoalXp}.`}
          </p>
          <div className="arena__actions">
            {nextLesson ? (
              <Button variant="primary" size="lg" onClick={() => startLesson(nextLesson.id)}>
                <Icon name="play" size={15} filled />
                {nextLesson.title}
                <span className="arena__xp">+XP</span>
              </Button>
            ) : null}
            <Button size="lg" onClick={() => navigate('/learn/shop')}>
              <Icon name="cart" size={15} /> Shop
            </Button>
            <Button size="lg" onClick={() => navigate('/learn/leaderboard')}>
              <Icon name="trophy" size={15} /> Leaderboard
            </Button>
          </div>
        </div>
        <div className="arena__meta">
          <div className={`arena__stat arena__stat--fire${alive && profile.streak > 0 ? ' is-hot' : ''}`}>
            <Icon name="flame" size={22} filled />
            <b>{alive ? profile.streak : 0}</b>
            <span>day streak</span>
          </div>
          <div className="arena__stat arena__stat--xp">
            <Icon name="bolt" size={22} filled />
            <b>{profile.xp.toLocaleString('en')}</b>
            <span>total XP</span>
          </div>
          <button type="button" className="arena__stat arena__stat--coin" onClick={() => navigate('/learn/shop')}>
            <Icon name="coin" size={22} />
            <b>{profile.coins.toLocaleString('en')}</b>
            <span>coins · spend</span>
          </button>
          <div className="arena__goal">
            <svg viewBox="0 0 42 42" className="arena__ring" role="img" aria-label={`Daily goal ${goalPercent}%`}>
              <circle cx="21" cy="21" r="17" className="arena__ring-track" />
              <circle
                cx="21"
                cy="21"
                r="17"
                className="arena__ring-fill"
                strokeDasharray={`${(goalPercent / 100) * 106.8} 106.8`}
              />
            </svg>
            <div>
              <b>
                {profile.todayXp}/{profile.dailyGoalXp}
              </b>
              <span>today’s XP</span>
            </div>
          </div>
        </div>
      </header>

      <section className="arena__week" aria-label="Your last seven days">
        {data.week.map((item) => (
          <span key={item.day} className={item.day === today ? 'is-today' : ''} title={`${item.day}: ${item.xp} XP`}>
            <span className="arena__week-bar">
              <i style={{ height: `${Math.max(12, Math.round((item.xp / maxWeek) * 100))}%` }} className={item.xp > 0 ? 'on' : ''} />
            </span>
            <small>{weekdayInitial(item.day)}</small>
            <em>{item.xp}</em>
          </span>
        ))}
        <p className="arena__week-note muted small">
          {doneCount} of {totalLessons} lessons finished · {questsDone}/{data.quests.length} quests today
        </p>
      </section>

      <div className="learn__grid">
        <aside className="learn__today" aria-label="Today">
          <section className="card learn-card quests-card">
            <header className="learn-card__head">
              <h2>Today’s quests</h2>
              <span className="learn-card__count">{questsDone}/{data.quests.length}</span>
            </header>
            <ul className="quests">
              {data.quests.map((quest) => {
                const percent = Math.min(100, Math.round((quest.progress / Math.max(1, quest.target)) * 100));
                return (
                  <li key={quest.key} className={quest.claimed ? 'is-done' : ''}>
                    <div className="quests__row">
                      <b>{quest.label}</b>
                      <span className="quests__coins">
                        <Icon name="coin" size={12} /> {quest.coins}
                      </span>
                    </div>
                    <div className="quests__bar">
                      <i style={{ width: `${percent}%` }} />
                    </div>
                    <span className="quests__state tiny muted">
                      {quest.claimed ? 'Paid' : `${quest.progress}/${quest.target}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Ranking</h2>
              <Link className="learn-card__link" to="/learn/leaderboard">
                All <Icon name="arrowRight" size={13} />
              </Link>
            </header>
            {boardTop.length === 0 ? (
              <p className="muted small">Finish a lesson this week and your name goes on the board.</p>
            ) : (
              <ol className="mini-board">
                {boardTop.map((row) => (
                  <li key={row.rank} className={row.isMe ? 'is-me' : ''}>
                    <span className="mini-board__rank">{['🥇', '🥈', '🥉'][row.rank - 1] ?? row.rank}</span>
                    <b>{row.name}</b>
                    <span>{row.valueLabel}</span>
                  </li>
                ))}
              </ol>
            )}
            {board.data?.me ? (
              <p className="muted tiny">
                You are <b>#{board.data.me.rank}</b> this week with {board.data.me.valueLabel}.
              </p>
            ) : null}
          </section>

          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Study plan</h2>
              <Link className="learn-card__link" to="/learn/plan">
                Open <Icon name="arrowRight" size={13} />
              </Link>
            </header>
            <p className="muted small">A dated route from your current band to the one you want, built from your recent test scores.</p>
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
                          <button
                            type="button"
                            className="daily-words__term"
                            onClick={() => {
                              sfx.play('select');
                              setLookup(word.term);
                            }}
                            title={`Look up “${word.term}”`}
                          >
                            {word.term}
                          </button>
                          {word.pos ? <span className="muted tiny">{word.pos}</span> : null}
                          {canSpeak() ? (
                            <button
                              type="button"
                              className="vocab-item__speak"
                              onClick={() => {
                                sfx.play('select');
                                speak(word.term);
                              }}
                              aria-label={`Hear “${word.term}”`}
                            >
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
            <Button
              variant="primary"
              block
              disabled={data.dueWords === 0}
              onClick={() => {
                sfx.play('lessonStart');
                navigate('/learn/review');
              }}
            >
              Start review
            </Button>
          </section>

          <section className="card learn-card">
            <header className="learn-card__head">
              <h2>Your band</h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  sfx.play('select');
                  setBandOpenModal(true);
                }}
              >
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
                    sfx.play('select');
                    setBand(item.band);
                    setOpenLesson(null);
                  }}
                  aria-current={on ? 'true' : undefined}
                  title={LEARN_BAND_LABELS[item.band]}
                >
                  <b>{item.band.toFixed(1)}</b>
                  <span>{empty ? 'no lessons yet' : `${item.completedCount}/${item.lessonCount}`}</span>
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
                    Finish band {blockingBand?.toFixed(1)} to open this band, or set your own band to jump straight here.
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
                        <li
                          key={lesson.id}
                          className={`node-row${state === 'locked' ? ' node-row--locked' : ''}`}
                          style={{ '--offset': `${offset}px` } as React.CSSProperties}
                        >
                          <div className="node-wrap">
                            {state === 'current' ? <span className="node-start">Start</span> : null}
                            <button
                              type="button"
                              className={`node node--${state}`}
                              aria-expanded={open}
                              aria-label={`${lesson.title}, ${state === 'locked' ? 'locked' : state === 'done' ? 'finished' : 'available'}`}
                              onClick={() => openNode(lesson, state !== 'locked')}
                            >
                              <Icon name={icon} size={28} strokeWidth={state === 'done' ? 3.2 : 2.2} filled={state === 'current'} />
                            </button>
                            {item && item.completions > 0 ? <Stars value={item.stars} size={13} /> : null}
                          </div>
                          <div className="node-label">
                            <b>{lesson.title}</b>
                            <span>{lesson.blurb}</span>
                            <em className="node-kind">{LESSON_KIND_LABELS[lesson.kind]}</em>
                            {lesson.legendary ? (
                              <em className="node-kind" style={{ color: '#b8860b', fontWeight: 700 }}>★ Legendary</em>
                            ) : null}
                          </div>
                          {open ? (
                            <div className="node-pop" role="dialog" aria-label={lesson.title}>
                              <h3>{lesson.title}</h3>
                              <p className="muted small">{lesson.blurb}</p>
                              <p className="node-pop__words">{lesson.preview}</p>
                              {state === 'locked' ? (
                                <p className="small">Finish {previous?.title ?? 'the previous lesson'} to unlock this lesson.</p>
                              ) : (
                                <Button variant="primary" block onClick={() => startLesson(lesson.id)}>
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

      <Modal open={lookup !== null} onClose={() => setLookup(null)} title={lookup ? `Dictionary: ${lookup}` : 'Dictionary'}>
        {lookup ? <DictionaryPanel key={lookup} compact initialTerm={lookup} autoFocus /> : null}
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
