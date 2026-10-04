import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../lib/sfx';
import {
  MAX_HEARTS,
  checkOrder,
  checkSentence,
  checkTyped,
  correctAnswerText,
  scoreLesson,
  type Exercise,
  type LessonScore,
  type MatchExercise,
  type OrderExercise,
  type ParaphraseExercise,
  type ReadExercise,
  type SpeakExercise,
  type TypeExercise,
  type WriteExercise,
} from '@shared/learn-engine';
import type { ShopState } from '@shared/shop';
import { HINT_REMOVES_OPTIONS, boostState } from '@shared/shop';
import { canSpeak, getPreferredVoiceURI, isServerVoice, listEnglishVoices, listServerVoices, serverVoiceOf, setPreferredVoiceURI, speak, speakWithServer } from '../../lib/speech';
import { learnApi } from '../../lib/learn-api';
import type { TranslationResult } from '@shared/learn';
import { Icon } from '../Icon';
import { Button, useToast } from '../ui';
import { Stars } from './Stars';
import { Mascot, reactionTo, type MascotMood } from './Mascot';
import { ComboBadge, ComboMilestone, Confetti, FloatingAward, ScreenFlash, comboMilestone } from './Effects';
import { LookupHint, LookupProvider, LookupText } from './LookupText';
import { BLOCKED_MESSAGE, useInputLockdown } from '../../hooks/useInputLockdown';

/**
 * The lesson player.
 *
 * One exercise at a time, five hearts, and a verdict that says what the right
 * answer was and why — now with a creature, a sound for every event, and a
 * translation of the whole sentence the learner has just met.
 *
 * What the learner should feel, in order: choosing something is a click, being
 * right is a hop and a chime, being wrong is a droop and a low buzz (and never a
 * dead end — the exercise comes back once), and finishing is a small ceremony.
 * The sound library (`lib/sfx.ts`) has one distinct effect per event so the
 * verdict arrives before the eyes do.
 *
 * Three things are paid for with coins earned in the path: a hint that halves
 * the choices, a refill after a wipe-out, and the double-XP item (which is
 * switched on in the shop and shows here as a running badge). The wallet is
 * read once when the lesson opens and refreshed after every spend, so the
 * header never shows a balance the server disagrees with.
 */
type Phase = 'answering' | 'feedback' | 'done' | 'failed';

interface Outcome {
  terms: string[];
  firstTryCorrect: boolean;
}

/** What the page hands back after saving: shown on the finish screen. */
export interface LessonFinish {
  xpGained: number;
  stars?: number;
  lines: string[];
  /** Coins paid by the lesson (and any quest it completed). */
  coins?: number;
  /** The award was doubled by a running boost. */
  boosted?: boolean;
}

/** Turns a YouTube watch / youtu.be / embed link into an embeddable URL; other URLs pass through. */
function embeddableVideo(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  const yt = value.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  return /^https:\/\//.test(value) ? value : null;
}

/**
 * Translations already fetched in this tab.
 *
 * The server caches by sentence for the whole platform; this only saves the
 * round trip when a learner replays a lesson, which is exactly when they are
 * paying the least attention to a spinner.
 */
const TRANSLATIONS = new Map<string, TranslationResult>();

function useSentenceTranslation(sentence: string, active: boolean): TranslationResult | null {
  const key = sentence.trim().toLowerCase();
  const [entry, setEntry] = useState<{ key: string; value: TranslationResult } | null>(() => {
    const cached = key ? TRANSLATIONS.get(key) : undefined;
    return cached ? { key, value: cached } : null;
  });

  // Derived during render: a result cached for this sentence (by an earlier
  // question, or an earlier visit in this tab) is used immediately; otherwise
  // the fetch below is what fills it in.
  const state = entry?.key === key ? entry.value : key ? TRANSLATIONS.get(key) ?? null : null;

  useEffect(() => {
    if (!active || key.length < 4 || TRANSLATIONS.has(key)) return;
    let cancelled = false;
    learnApi
      .translate(sentence)
      .then((result) => {
        TRANSLATIONS.set(key, result);
        if (!cancelled) setEntry({ key, value: result });
      })
      .catch(() => {
        if (!cancelled) setEntry({ key, value: { vi: '', source: 'NONE', available: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [key, sentence, active]);

  return state;
}

/** The sentence an exercise is about, with the word to emphasise. */
interface FeedbackModel {
  sentence: string;
  highlight?: string;
  explain: Exercise['explain'];
  note?: string;
  pairs?: MatchExercise['pairs'];
}

function feedbackModel(exercise: Exercise): FeedbackModel {
  switch (exercise.kind) {
    case 'choose':
    case 'listen':
    case 'type':
      return { sentence: exercise.explain.example, highlight: exercise.explain.term, explain: exercise.explain };
    case 'fill': {
      // The blank is filled in, so the panel can show (and translate) the whole
      // sentence rather than the gapped version the learner answered.
      const answer = exercise.options[exercise.answer] ?? '';
      return { sentence: exercise.sentence.replace(/_{2,}/, answer), highlight: answer, explain: exercise.explain };
    }
    case 'order':
      return { sentence: exercise.answer.join(' '), highlight: exercise.explain.term, explain: exercise.explain };
    case 'match':
      return { sentence: '', explain: exercise.explain, pairs: exercise.pairs };
    case 'paraphrase':
      return { sentence: exercise.options[exercise.answer] ?? '', explain: exercise.explain, note: exercise.note };
    case 'read':
      return { sentence: exercise.evidence, explain: exercise.explain, note: `Question: ${exercise.stem}` };
    case 'write':
      return { sentence: exercise.answer, explain: exercise.explain };
    case 'speak':
      return { sentence: exercise.sample, explain: exercise.explain };
  }
}

export function LessonPlayer({
  title,
  exercises,
  onExit,
  onFinish,
  onRestart,
  videoUrl,
  legendary,
}: {
  title: string;
  exercises: Exercise[];
  onExit: () => void;
  onFinish: (score: LessonScore) => Promise<LessonFinish>;
  onRestart: () => void;
  videoUrl?: string;
  legendary?: boolean;
}) {
  const toast = useToast();
  const [queue, setQueue] = useState<Exercise[]>(exercises);
  const [index, setIndex] = useState(0);
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [soundOn, setSoundOn] = useState(() => sfx.isEnabled());
  const [phase, setPhase] = useState<Phase>('answering');
  const [verdict, setVerdict] = useState<{ correct: boolean; almost?: boolean } | null>(null);
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState<LessonFinish | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [wallet, setWallet] = useState<ShopState | null>(null);
  const [walletError, setWalletError] = useState(false);
  const [busyItem, setBusyItem] = useState(false);
  const [hinted, setHinted] = useState(false);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [confetti, setConfetti] = useState(0);
  const [milestone, setMilestone] = useState<{ burst: number; combo: number }>({ burst: 0, combo: 0 });
  const [flash, setFlash] = useState<{ burst: number; tone: 'good' | 'bad' | 'goal' | 'level' }>({ burst: 0, tone: 'good' });
  const [award, setAward] = useState<{ burst: number; amount: number; tone: 'xp' | 'coin' | 'heart' }>({ burst: 0, amount: 0, tone: 'xp' });
  const [clock, setClock] = useState(0);
  const retried = useRef(new Set<string>());
  // The exercise component reports its current answer here; `check` reads it.
  const submit = useRef<(() => { correct: boolean; almost?: boolean } | null) | null>(null);
  // A lesson is a full-screen surface of its own (it sits outside the app shell
  // route), so it carries the same refusal of right-click and developer tools —
  // once explained per lesson, then silently, because the answering is the point.
  const explained = useRef(false);
  useInputLockdown({
    onBlocked: (kind) => {
      if (explained.current) return;
      explained.current = true;
      toast.push(BLOCKED_MESSAGE[kind], 'warning');
    },
  });
  const finished = Math.min(Object.keys(outcomes).length, exercises.length);
  const total = exercises.length;
  const current = queue[index];

  const baseId = (exercise: Exercise) => exercise.id.replace(/:retry$/, '');

  // The wallet (coins, items, running boost) is read once: the header shows it
  // and the hint/refill buttons spend it.
  useEffect(() => {
    let cancelled = false;
    learnApi
      .shop()
      .then((state) => {
        if (!cancelled) setWallet(state);
      })
      .catch(() => {
        if (!cancelled) setWalletError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The boost badge counts down; a tick every 30 s is enough for a label in minutes.
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // The lesson opens with its own sound, before anything is answered.
  useEffect(() => {
    sfx.play('lessonStart');
  }, []);

  const boost = boostState(wallet?.xpBoostUntil, new Date());
  void clock; // re-render tick for the boost countdown

  const celebrate = useCallback((tone: 'good' | 'bad' | 'goal' | 'level', pieces?: number, perfect = false) => {
    setFlash((previous) => ({ burst: previous.burst + 1, tone }));
    if (pieces) {
      void perfect;
      setConfetti((value) => value + 1);
    }
  }, []);

  const finish = useCallback(
    async (score: LessonScore) => {
      setSaving(true);
      setSaveError(null);
      try {
        const response = await onFinish(score);
        setResult(response);
        setPhase('done');
        const perfect = score.total > 0 && score.correct === score.total;
        sfx.play(perfect ? 'perfect' : 'complete');
        celebrate(perfect ? 'level' : 'good', perfect ? 120 : 60, perfect);
        setAward({ burst: Date.now(), amount: response.coins ?? 0, tone: 'coin' });
        window.setTimeout(() => sfx.play('coin'), 700);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Your progress could not be saved.');
        setPhase('done');
        sfx.play('error');
      } finally {
        setSaving(false);
      }
    },
    [onFinish, celebrate],
  );

  const check = () => {
    if (!current || phase !== 'answering') return;
    const outcome = submit.current?.();
    if (!outcome) return;
    const id = baseId(current);
    const firstAttempt = !(id in outcomes);
    const wasRetry = retried.current.has(id);

    if (!(id in outcomes)) {
      setOutcomes((previous) => ({ ...previous, [id]: { terms: current.terms, firstTryCorrect: outcome.correct } }));
    }

    if (outcome.correct) {
      // First-try answers extend the run; a run of five is a different event
      // from a run of four, so it gets its own fanfare, its own banner and its
      // own confetti — the badge in the footer is the quiet, ongoing version of
      // the same fact.
      const nextCombo = firstAttempt ? combo + 1 : combo;
      const milestone = firstAttempt ? comboMilestone(nextCombo) : null;

      if (outcome.almost) {
        sfx.play('almost');
      } else if (milestone) {
        sfx.play('milestone', milestone.tier);
      } else if (firstAttempt && nextCombo >= 2) {
        sfx.play('combo', nextCombo);
      } else {
        sfx.correct();
      }

      if (firstAttempt) {
        setCombo(nextCombo);
        setBestCombo((best) => Math.max(best, nextCombo));
        setAward({ burst: Date.now(), amount: 1, tone: 'xp' });
        if (milestone) {
          // The banner carries its own confetti (see `ComboMilestone`), so this
          // only washes the screen in the tier's colour underneath it.
          // `burst` is a counter, not a timestamp: the banner is keyed by it, and
          // two runs of five must never share a key — a repeated key would reuse
          // the element and its already-finished animation instead of replaying
          // it (which is exactly what a frozen clock does in a test).
          setMilestone((previous) => ({ burst: previous.burst + 1, combo: nextCombo }));
          celebrate(milestone.tier >= 3 ? 'level' : 'goal');
        } else if (nextCombo >= 3) {
          celebrate('good');
        }
      }
      // A milestone has already set the flash and the confetti; the plain wash
      // would only overwrite the colour it chose.
      if (!milestone) celebrate('good');
      setVerdict(outcome);
      setPhase('feedback');
      window.setTimeout(() => sfx.play('reveal'), 220);
      return;
    }

    // Wrong: a heart, a droop, and — if that was the last one — the fail screen.
    setCombo(0);
    sfx.incorrect();
    celebrate('bad');
    const left = hearts - 1;
    setHearts(left);
    setAward({ burst: Date.now(), amount: -1, tone: 'heart' });
    if (!wasRetry) {
      retried.current.add(id);
      setQueue((previous) => [...previous, { ...current, id: `${id}:retry` }]);
    }
    setVerdict(outcome);
    if (left <= 0) {
      setPhase('failed');
      window.setTimeout(() => sfx.play('outOfHearts'), 300);
      return;
    }
    window.setTimeout(() => sfx.play('heartLost'), 260);
    setPhase('feedback');
  };

  const next = () => {
    if (index + 1 >= queue.length) {
      void finish(scoreLesson(Object.values(outcomes)));
      return;
    }
    sfx.play('whoosh');
    setHinted(false);
    setIndex(index + 1);
    setPhase('answering');
    setVerdict(null);
    setAnswered(false);
  };

  /** Spends one item from the wallet and applies it: the only place items are used here. */
  const spend = async (key: 'hint' | 'heart_refill') => {
    if (busyItem) return null;
    setBusyItem(true);
    try {
      const response = await learnApi.useItem(key);
      setWallet(response.state);
      if (!response.applied) sfx.play('error');
      return response;
    } catch {
      sfx.play('error');
      return null;
    } finally {
      setBusyItem(false);
    }
  };

  const spendHint = async () => {
    if (hinted || phase !== 'answering' || !current) return;
    const response = await spend('hint');
    if (!response?.applied) return;
    setHinted(true);
    sfx.play('hint');
  };

  const spendRefill = async () => {
    const response = await spend('heart_refill');
    if (!response?.applied) return;
    setHearts(3);
    sfx.play('boost');
    setAward({ burst: Date.now(), amount: 3, tone: 'heart' });
    // Back to the answer they just missed, with the verdict showing, so the
    // lesson reads as "here is what it was, carry on" rather than a fresh question.
    setPhase('feedback');
    setVerdict({ correct: false });
  };

  // Enter checks or continues; it is the keyboard path through a whole lesson.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === 'BUTTON' && target.dataset.keepEnter !== 'true') return;
      event.preventDefault();
      if (phase === 'answering' && answered) check();
      else if (phase === 'feedback') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const percent = total === 0 ? 0 : Math.round((finished / total) * 100);
  const hints = wallet?.inventory.hint ?? 0;
  const refills = wallet?.inventory.heart_refill ?? 0;

  if (phase === 'failed') {
    return (
      <div className="lesson lesson--failed">
        <ScreenFlash burst={flash.burst} tone={flash.tone} />
        <div className="lesson__end">
          <Mascot mood="sad" size={168} message="That is all five hearts. Nothing is lost — the words will come round again." tone="bad" />
          <h1>Out of hearts</h1>
          <p className="muted">
            You ran out of tries on “{title}”. Your XP and coins so far are kept, and the words you missed will come back in your review.
            {refills > 0 ? ' A heart refill picks the lesson up where it stopped.' : ''}
          </p>
          <div className="lesson__end-actions">
            {refills > 0 ? (
              <Button variant="primary" size="lg" loading={busyItem} onClick={() => void spendRefill()}>
                <Icon name="heart" size={16} filled />
                Use a heart refill ({refills} left)
              </Button>
            ) : (
              // Nothing left to spend: the shop is where a refill comes from,
              // and this lesson cannot be resumed across a page change.
              <Button variant="primary" size="lg" onClick={onExit}>
                <Icon name="cart" size={16} />
                Get a refill in the shop
              </Button>
            )}
            <Button size="lg" onClick={onRestart}>
              Try the lesson again
            </Button>
            <Button size="lg" variant="ghost" onClick={onExit}>
              Back to the path
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const score = scoreLesson(Object.values(outcomes));
    const perfect = score.total > 0 && score.correct === score.total;
    return (
      <div className="lesson lesson--done">
        <Confetti burst={confetti} pieces={perfect ? 120 : 60} tone={perfect ? 'perfect' : 'good'} />
        <ScreenFlash burst={flash.burst} tone={flash.tone} />
        <div className="lesson__end">
          <Mascot
            mood={perfect ? 'wow' : 'happy'}
            size={196}
            message={
              perfect
                ? 'A perfect run. Every answer right first time — that is a lesson finished properly.'
                : 'Lesson finished. Every exercise ended up right, which is what counts.'
            }
            tone="good"
          />
          <h1>{perfect ? 'Perfect lesson' : 'Lesson complete'}</h1>
          <p className="muted">{title}</p>
          <dl className="lesson__stats">
            <div>
              <dt>XP</dt>
              <dd>
                {result ? `+${result.xpGained}` : '—'}
                {result?.boosted ? <em className="lesson__boost-tag">×2</em> : null}
              </dd>
            </div>
            <div>
              <dt>Coins</dt>
              <dd>{result?.coins ? `+${result.coins}` : result?.coins === 0 ? '+0' : '—'}</dd>
            </div>
            <div>
              <dt>First-try</dt>
              <dd>{score.total ? Math.round((score.correct / score.total) * 100) : 0}%</dd>
            </div>
            <div>
              <dt>Best run</dt>
              <dd>×{Math.max(bestCombo, combo)}</dd>
            </div>
            {result?.stars ? (
              <div>
                <dt>Stars</dt>
                <dd>
                  <Stars value={result.stars} size={22} />
                </dd>
              </div>
            ) : null}
          </dl>
          {result?.lines.map((line) => (
            <p key={line} className="lesson__line">
              {line}
            </p>
          ))}
          {saveError ? <p className="lesson__line lesson__line--warn">{saveError} Your answers are not lost; try finishing again.</p> : null}
          <div className="lesson__end-actions">
            {saveError ? (
              <Button variant="primary" size="lg" loading={saving} onClick={() => void finish(score)}>
                Try saving again
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={onExit}>
                Continue
              </Button>
            )}
            <Button size="lg" onClick={onRestart}>
              Practise again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isRetry = current?.id.endsWith(':retry');
  const reaction = reactionTo(phase === 'feedback' ? verdict : null);
  const model = current ? feedbackModel(current) : null;

  return (
    <LookupProvider enabled={!legendary}>
      <div className={`lesson lesson--${phase}`}>
        <ScreenFlash burst={flash.burst} tone={flash.tone} />
        <ComboMilestone burst={milestone.burst} combo={milestone.combo} />
        <header className="lesson__top">
          <button type="button" className="lesson__close" onClick={onExit} aria-label="Leave the lesson">
            <Icon name="close" size={20} />
          </button>
          <div className="lesson__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Lesson progress">
            <div className="lesson__bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="lesson__hearts" aria-label={`${hearts} hearts left`} title={`${hearts} of ${MAX_HEARTS} hearts`}>
            {Array.from({ length: MAX_HEARTS }, (_, index) => (
              <Icon key={index} name="heart" size={15} filled={index < hearts} style={{ opacity: index < hearts ? 1 : 0.28 }} />
            ))}
          </span>
          {wallet && !legendary ? <span className="lesson__coins" title="Coins">🪙 {wallet.coins}</span> : null}
          {boost.active ? (
            <span className="lesson__boost" title={`Double XP for ${boost.minutesLeft} more minutes`}>
              ⚡ ×2 · {boost.minutesLeft}m
            </span>
          ) : null}
          {wallet && !legendary ? (
            <button
              type="button"
              className="lesson__hint"
              onClick={() => void spendHint()}
              disabled={hinted || hints === 0 || phase !== 'answering'}
              title={hints === 0 ? 'No hints left — buy one in the shop' : `Use a hint (${hints} left)`}
              aria-label={`Use a hint, ${hints} left`}
            >
              <Icon name="sparkle" size={15} />
              {hints}
            </button>
          ) : null}
          <button
            type="button"
            className="lesson__close"
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
            title={soundOn ? 'Mute sounds' : 'Unmute sounds'}
            onClick={() => {
              const nextValue = !soundOn;
              setSoundOn(nextValue);
              sfx.setEnabled(nextValue);
              if (nextValue) sfx.play('select');
            }}
          >
            <Icon name="volume" size={18} style={{ opacity: soundOn ? 1 : 0.45 }} />
          </button>
        </header>

        <main className="lesson__main">
          {legendary ? (
            <p className="lesson__retry" style={{ color: '#b8860b', fontWeight: 700 }}>★ Legendary — harder set. Look-ups are off; answer from memory.</p>
          ) : null}
          {walletError ? <p className="lesson__retry muted">The shop is unreachable, so hints and refills are off for this lesson.</p> : null}
          {videoUrl && embeddableVideo(videoUrl) ? (
            <div className="lesson__video" style={{ margin: '0 0 14px' }}>
              <iframe
                src={embeddableVideo(videoUrl)!}
                title="Lesson video"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 12, background: '#000' }}
              />
            </div>
          ) : null}
          {current ? (
            <div className="lesson__stage" key={current.id}>
              {isRetry ? <p className="lesson__retry">Try this one again</p> : null}
              <ExerciseView
                exercise={current}
                disabled={phase !== 'answering'}
                hinted={hinted}
                verdict={verdict}
                registerSubmit={(fn) => {
                  submit.current = fn;
                }}
                onAnswered={setAnswered}
              />
              <div className="lesson__mascot">
                <Mascot
                  mood={phase === 'feedback' ? reaction.mood : isRetry ? 'think' : 'idle'}
                  size={92}
                  message={phase === 'feedback' ? reaction.message : isRetry ? 'This one again — you know it now.' : undefined}
                  tone={reaction.tone}
                />
              </div>
            </div>
          ) : null}
        </main>

        <footer className={`lesson__foot${phase === 'feedback' ? (verdict?.correct ? ' lesson__foot--good' : ' lesson__foot--bad') : ''}`}>
          <div className="lesson__foot-inner">
            {phase === 'feedback' && current && model ? (
              <div className="lesson__feedback" role="status" aria-live="polite">
                <div className="lesson__feedback-head">
                  <strong>{verdict?.correct ? (verdict.almost ? 'Almost — mind the spelling' : 'Correct') : 'Not quite'}</strong>
                  {!verdict?.correct || verdict?.almost ? (
                    <span className="lesson__answer">
                      Answer: <b>{correctAnswerText(current)}</b>
                    </span>
                  ) : null}
                  <ComboBadge combo={verdict?.correct ? combo : 0} />
                </div>

                {model.sentence ? (
                  <LookupText as="p" className="lesson__sentence" text={model.sentence} highlight={model.highlight} />
                ) : null}
                {model.pairs ? (
                  <ul className="lesson__pairs">
                    {model.pairs.map((pair) => (
                      <li key={pair.id}>
                        <b>{pair.term}</b>
                        <span> = {pair.meaning}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {model.note ? <p className="lesson__note">{model.note}</p> : null}

                <FeedbackTranslation sentence={model.sentence} explain={model.explain} />
              </div>
            ) : (
              <div className="lesson__feedback lesson__feedback--quiet">
                <LookupHint compact />
                <span className="muted small">Answer every question right and the lesson is yours.</span>
              </div>
            )}
            <div className="lesson__foot-actions">
              <FloatingAward burst={award.burst} amount={award.amount} suffix={award.tone === 'xp' ? 'XP' : award.tone === 'coin' ? 'coins' : 'heart'} tone={award.tone} />
              {phase === 'feedback' ? (
                <Button variant={verdict?.correct ? 'success' : 'danger'} size="lg" onClick={next} data-keep-enter="true">
                  Continue
                </Button>
              ) : (
                <Button variant="primary" size="lg" onClick={check} disabled={!answered}>
                  Check
                </Button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </LookupProvider>
  );
}

/**
 * The Vietnamese rendering of the sentence, with the word's own meaning beside
 * it.
 *
 * Both lines matter and they say different things: the translation is the
 * sentence ("The lecture on history starts at nine." → "Buổi giảng về lịch sử
 * bắt đầu lúc chín giờ."), and the meaning is the word the exercise was about.
 * When no provider answers, the word's gloss is still shown — it is the part
 * that a learner can always have — with a quiet note rather than an error.
 */
function FeedbackTranslation({ sentence, explain }: { sentence: string; explain: Exercise['explain'] }) {
  const translation = useSentenceTranslation(sentence, Boolean(sentence));
  const hasWord = Boolean(explain.term && explain.meaning);

  return (
    <div className="lesson__translation">
      {sentence ? (
        <p className={`lesson__vi${translation?.available ? '' : ' lesson__vi--empty'}`}>
          <span className="lesson__vi-label">Nghĩa cả câu</span>
          {translation === null ? <em className="lesson__vi-loading">translating…</em> : null}
          {translation?.available ? <span lang="vi">{translation.vi}</span> : null}
          {translation && !translation.available ? (
            <em className="muted">
              The translation service is off, so here is the new word. Turn on a provider in Admin → AI to translate whole sentences.
            </em>
          ) : null}
        </p>
      ) : null}
      {hasWord ? (
        <p className="lesson__explain">
          <b>{explain.term}</b> <span className="muted">({explain.pos})</span> — {explain.meaning}
          {explain.vi ? <span className="lesson__explain-vi" lang="vi"> · {explain.vi}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ exercises
interface ViewProps {
  exercise: Exercise;
  disabled: boolean;
  /** A hint was paid for on this question. */
  hinted: boolean;
  verdict: { correct: boolean; almost?: boolean } | null;
  registerSubmit: (fn: () => { correct: boolean; almost?: boolean } | null) => void;
  onAnswered: (ready: boolean) => void;
}

function ExerciseView(props: ViewProps) {
  const { exercise } = props;
  switch (exercise.kind) {
    case 'choose':
    case 'fill':
    case 'listen':
      return <OptionExercise {...props} />;
    case 'type':
      return <TypeExerciseView {...props} exercise={exercise} />;
    case 'order':
      return <OrderExerciseView {...props} exercise={exercise} />;
    case 'match':
      return <MatchExerciseView {...props} exercise={exercise} />;
    case 'paraphrase':
      return <ParaphraseExerciseView {...props} exercise={exercise} />;
    case 'read':
      return <ReadExerciseView {...props} exercise={exercise} />;
    case 'write':
      return <WriteExerciseView {...props} exercise={exercise} />;
    case 'speak':
      return <SpeakExerciseView {...props} exercise={exercise} />;
  }
}

/**
 * The two wrong options a hint removes.
 *
 * Chosen once per question (the random pick stays put while the question is on
 * screen) and never the answer itself: a hint that can remove the right option
 * is a bug, not a gift.
 */
function eliminatedOptions(options: readonly string[], answer: number, hinted: boolean, seed: string): Set<number> {
  if (!hinted) return new Set();
  const wrong: number[] = [];
  for (let index = 0; index < options.length; index += 1) {
    if (index !== answer) wrong.push(index);
  }
  // A cheap stable shuffle: the option's own text decides its place.
  wrong.sort((a, b) => `${seed}${options[a]}`.localeCompare(`${seed}${options[b]}`));
  return new Set(wrong.slice(0, HINT_REMOVES_OPTIONS));
}

function OptionExercise({ exercise, disabled, hinted, verdict, registerSubmit, onAnswered }: ViewProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const spoken = useRef(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [serverVoices, setServerVoices] = useState<string[]>([]);
  const [voiceURI, setVoiceURI] = useState<string | null>(getPreferredVoiceURI());
  const [audioFailed, setAudioFailed] = useState(false);
  const options = exercise.kind === 'choose' || exercise.kind === 'fill' || exercise.kind === 'listen' ? exercise.options : [];
  const answer = exercise.kind === 'choose' || exercise.kind === 'fill' || exercise.kind === 'listen' ? exercise.answer : -1;
  // Computed from the exercise itself so the map does not rebuild on every render.
  const eliminated = useMemo(
    () => eliminatedOptions(options, answer, hinted, exercise.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercise, hinted],
  );
  const speakWith = (text: string, rate: number, choice: string | null) =>
    isServerVoice(choice) ? speakWithServer(text, serverVoiceOf(choice as string)) : speak(text, rate, choice);

  const play = (rate = 0.9) => {
    setAudioFailed(false);
    void speakWith(exercise.kind === 'listen' ? exercise.speak : '', rate, voiceURI).then((ok) => setAudioFailed(!ok));
  };

  useEffect(() => {
    registerSubmit(() => (picked === null ? null : { correct: picked === answer }));
  }, [picked, answer, registerSubmit]);
  useEffect(() => onAnswered(picked !== null), [picked, onAnswered]);

  useEffect(() => {
    if (exercise.kind !== 'listen') return;
    void listEnglishVoices().then(setVoices);
    void listServerVoices().then(setServerVoices);
    if (!spoken.current) {
      spoken.current = true;
      void speakWith(exercise.speak, 0.9, voiceURI).then((ok) => setAudioFailed(!ok));
    }
  }, [exercise, voiceURI]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled) return;
      const number = Number(event.key);
      if (number >= 1 && number <= options.length && !eliminated.has(number - 1)) {
        sfx.play('tap');
        setPicked(number - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, options.length, eliminated]);

  return (
    <div>
      {exercise.kind === 'choose' ? (
        <>
          <p className="lesson__kicker">Choose the meaning</p>
          <h1 className="lesson__prompt">
            <LookupText as="span" text={exercise.prompt} highlight={exercise.explain.term} />
          </h1>
        </>
      ) : null}
      {exercise.kind === 'fill' ? (
        <>
          <p className="lesson__kicker">Complete the sentence</p>
          <h1 className="lesson__prompt lesson__prompt--sentence">
            <LookupText as="span" text={exercise.sentence} />
          </h1>
        </>
      ) : null}
      {exercise.kind === 'listen' ? (
        <>
          <p className="lesson__kicker">Listen and choose</p>
          <div className="lesson__listen">
            <button type="button" className="lesson__speaker" onClick={() => play(0.9)} aria-label="Play the word">
              <Icon name="play" size={26} />
            </button>
            <button type="button" className="lesson__speaker lesson__speaker--slow" onClick={() => play(0.55)} aria-label="Play slowly">
              <Icon name="rotate" size={20} />
            </button>
            {serverVoices.length > 0 || voices.length > 1 ? (
              <select
                className="lesson__voice"
                value={voiceURI ?? ''}
                aria-label="Choose a voice"
                onChange={(event) => {
                  const next = event.target.value || null;
                  setVoiceURI(next);
                  setPreferredVoiceURI(next);
                  setAudioFailed(false);
                  void speakWith(exercise.speak, 0.9, next).then((ok) => setAudioFailed(!ok));
                }}
              >
                {voiceURI === null ? <option value="">Default voice</option> : null}
                {serverVoices.length > 0 ? (
                  <optgroup label="AI voices">
                    {serverVoices.map((voice) => (
                      <option key={`srv:${voice}`} value={`srv:${voice}`}>
                        {voice[0]?.toUpperCase()}
                        {voice.slice(1)} (AI)
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {voices.length > 0 ? (
                  <optgroup label="This device">
                    {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            ) : null}
          </div>
          {!canSpeak() || audioFailed ? (
            <p className="muted small">
              This device will not play the audio. The word is “<LookupText as="span" text={exercise.speak} />”.
            </p>
          ) : null}
        </>
      ) : null}
      <div className="lesson__options" role="radiogroup">
        {options.map((option, optionIndex) => {
          const gone = eliminated.has(optionIndex);
          const state =
            disabled && verdict
              ? optionIndex === answer
                ? ' is-right'
                : optionIndex === picked
                  ? ' is-wrong'
                  : ''
              : picked === optionIndex
                ? ' is-picked'
                : '';
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={picked === optionIndex}
              className={`lesson__option${state}${gone ? ' is-eliminated' : ''}`}
              disabled={disabled || gone}
              onClick={() => {
                sfx.play('tap');
                setPicked(optionIndex);
              }}
            >
              <span className="lesson__key">{optionIndex + 1}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** How much of a typed answer a hint reveals: enough to start, never the whole word. */
function revealPrefix(answer: string): string {
  const shown = Math.max(2, Math.floor(answer.length / 3));
  return `${answer.slice(0, shown)}${'_'.repeat(Math.max(0, answer.length - shown))}`;
}

function TypeExerciseView({ exercise, disabled, hinted, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: TypeExercise }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    registerSubmit(() => (value.trim() ? checkTyped(value, exercise.answer) : null));
  }, [value, exercise.answer, registerSubmit]);
  useEffect(() => onAnswered(value.trim().length > 0), [value, onAnswered]);
  return (
    <div>
      <p className="lesson__kicker">Type the word</p>
      <h1 className="lesson__prompt">
        <LookupText as="span" text={exercise.prompt} />
      </h1>
      <p className="lesson__hint">
        Vietnamese: <b lang="vi">{exercise.hint}</b>
      </p>
      <p className="lesson__mask" aria-label={`${exercise.answer.length} letters`}>
        {hinted ? revealPrefix(exercise.answer) : exercise.mask}
      </p>
      <input
        ref={inputRef}
        className={`lesson__input${disabled && verdict ? (verdict.correct ? ' is-right' : ' is-wrong') : ''}`}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Type in English"
        aria-label="Your answer"
      />
    </div>
  );
}

function OrderExerciseView({ exercise, disabled, hinted, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: OrderExercise }) {
  // `picked` holds indices into `exercise.tokens`, in the order the learner tapped
  // them. `hintIndex` is the first word of the answer, and a hint that arrives
  // mid-question is placed for the learner — in the derived `chosen` below, not
  // by writing to state from an effect. The placed token cannot be tapped back
  // out, so there is nothing to undo.
  const hintIndex = hinted ? exercise.tokens.indexOf(exercise.answer[0] ?? '') : -1;
  const [picked, setPicked] = useState<number[]>([]);
  const chosen = useMemo(
    () => (hintIndex >= 0 && !picked.includes(hintIndex) ? [hintIndex, ...picked] : picked),
    [hintIndex, picked],
  );
  const setChosen = setPicked;
  useEffect(() => {
    registerSubmit(() =>
      chosen.length === exercise.tokens.length
        ? { correct: checkOrder(chosen.map((i) => exercise.tokens[i]!), exercise.answer) }
        : null,
    );
  }, [chosen, exercise, registerSubmit]);
  useEffect(() => onAnswered(chosen.length === exercise.tokens.length), [chosen, exercise.tokens.length, onAnswered]);
  return (
    <div>
      <p className="lesson__kicker">Build the sentence</p>
      <h1 className="lesson__prompt">
        <LookupText as="span" text={exercise.prompt} highlight={exercise.explain.term} />
      </h1>
      <div className={`lesson__line-up${disabled && verdict ? (verdict.correct ? ' is-right' : ' is-wrong') : ''}`} aria-label="Your sentence">
        {chosen.map((tokenIndex) => (
          <button
            key={tokenIndex}
            type="button"
            className={`lesson__token${hinted && tokenIndex === hintIndex ? ' is-hinted' : ''}`}
            disabled={disabled || (hinted && tokenIndex === hintIndex)}
            onClick={() => {
              sfx.play('tap');
              setChosen((previous) => previous.filter((item) => item !== tokenIndex));
            }}
          >
            {exercise.tokens[tokenIndex]}
          </button>
        ))}
      </div>
      <div className="lesson__bank" aria-label="Word bank">
        {exercise.tokens.map((token, tokenIndex) => (
          <button
            key={tokenIndex}
            type="button"
            className={`lesson__token${chosen.includes(tokenIndex) ? ' is-used' : ''}${hinted && tokenIndex === hintIndex ? ' is-hinted' : ''}`}
            disabled={disabled || chosen.includes(tokenIndex)}
            onClick={() => {
              sfx.play('tap');
              setChosen((previous) => [...previous, tokenIndex]);
            }}
          >
            {token}
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchExerciseView({ exercise, disabled, hinted, registerSubmit, onAnswered }: ViewProps & { exercise: MatchExercise }) {
  const [term, setTerm] = useState<number | null>(null);
  const [solved, setSolved] = useState<number[]>([]);
  const [wrongPair, setWrongPair] = useState<[number, number] | null>(null);
  const [slips, setSlips] = useState(0);
  const complete = solved.length === exercise.pairs.length;
  // A hint points at the first pair still to be found, in both columns.
  const hintedPair = hinted ? exercise.pairs.findIndex((_, index) => !solved.includes(index)) : -1;

  useEffect(() => {
    registerSubmit(() => (complete ? { correct: slips === 0 } : null));
  }, [complete, slips, registerSubmit]);
  useEffect(() => onAnswered(complete), [complete, onAnswered]);

  const pickMeaning = (pairIndex: number) => {
    if (disabled || term === null || solved.includes(pairIndex)) return;
    if (pairIndex === term) {
      sfx.play('match');
      setSolved((previous) => [...previous, pairIndex]);
      setTerm(null);
      setWrongPair(null);
    } else {
      sfx.play('wrong');
      setSlips((previous) => previous + 1);
      setWrongPair([term, pairIndex]);
      window.setTimeout(() => setWrongPair(null), 600);
    }
  };

  return (
    <div>
      <p className="lesson__kicker">Match the pairs</p>
      <h1 className="lesson__prompt">{exercise.prompt}</h1>
      <div className="lesson__match">
        <div className="lesson__match-col">
          {exercise.pairs.map((pair, pairIndex) => (
            <button
              key={pair.id}
              type="button"
              className={`lesson__option${solved.includes(pairIndex) ? ' is-right' : term === pairIndex ? ' is-picked' : ''}${wrongPair?.[0] === pairIndex ? ' is-wrong' : ''}${hintedPair === pairIndex ? ' is-hinted' : ''}`}
              disabled={disabled || solved.includes(pairIndex)}
              onClick={() => {
                sfx.play('select');
                setTerm(pairIndex);
              }}
            >
              {pair.term}
            </button>
          ))}
        </div>
        <div className="lesson__match-col">
          {exercise.meaningOrder.map((pairIndex) => (
            <button
              key={pairIndex}
              type="button"
              className={`lesson__option lesson__option--small${solved.includes(pairIndex) ? ' is-right' : ''}${wrongPair?.[1] === pairIndex ? ' is-wrong' : ''}${hintedPair === pairIndex ? ' is-hinted' : ''}`}
              disabled={disabled || solved.includes(pairIndex) || term === null}
              onClick={() => pickMeaning(pairIndex)}
            >
              {exercise.pairs[pairIndex]!.meaning}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Pick the restatement that keeps the meaning. */
function ParaphraseExerciseView({ exercise, disabled, hinted, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: ParaphraseExercise }) {
  const [picked, setPicked] = useState<number | null>(null);
  const eliminated = useMemo(() => eliminatedOptions(exercise.options, exercise.answer, hinted, exercise.id), [exercise, hinted]);
  useEffect(() => {
    registerSubmit(() => (picked === null ? null : { correct: picked === exercise.answer }));
  }, [picked, exercise.answer, registerSubmit]);
  useEffect(() => onAnswered(picked !== null), [picked, onAnswered]);

  return (
    <div>
      <p className="lesson__kicker">Choose the sentence that means the same</p>
      <h1 className="lesson__prompt lesson__prompt--sentence">
        <LookupText as="span" text={exercise.prompt} />
      </h1>
      <div className="lesson__options" role="radiogroup">
        {exercise.options.map((option, index) => {
          const gone = eliminated.has(index);
          const state =
            disabled && verdict
              ? index === exercise.answer
                ? ' is-right'
                : index === picked
                  ? ' is-wrong'
                  : ''
              : picked === index
                ? ' is-picked'
                : '';
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={picked === index}
              className={`lesson__option${state}${gone ? ' is-eliminated' : ''}`}
              disabled={disabled || gone}
              onClick={() => {
                sfx.play('tap');
                setPicked(index);
              }}
            >
              <span className="lesson__key">{index + 1}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      {verdict && !verdict.correct ? <p className="lesson__note">{exercise.note}</p> : null}
    </div>
  );
}

/** A short passage with four-option questions; the passage stays on screen. */
function ReadExerciseView({ exercise, disabled, hinted, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: ReadExercise }) {
  const [picked, setPicked] = useState<number | null>(null);
  const eliminated = useMemo(() => eliminatedOptions(exercise.options, exercise.answer, hinted, exercise.id), [exercise, hinted]);
  useEffect(() => {
    registerSubmit(() => (picked === null ? null : { correct: picked === exercise.answer }));
  }, [picked, exercise.answer, registerSubmit]);
  useEffect(() => onAnswered(picked !== null), [picked, onAnswered]);

  return (
    <div>
      <p className="lesson__kicker">Read and answer</p>
      <div className="lesson__passage">
        <LookupText as="span" text={exercise.passage} />
      </div>
      <h1 className="lesson__prompt lesson__prompt--sentence">
        <LookupText as="span" text={exercise.stem} />
      </h1>
      <div className="lesson__options" role="radiogroup">
        {exercise.options.map((option, index) => {
          const gone = eliminated.has(index);
          const state =
            disabled && verdict
              ? index === exercise.answer
                ? ' is-right'
                : index === picked
                  ? ' is-wrong'
                  : ''
              : picked === index
                ? ' is-picked'
                : '';
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={picked === index}
              className={`lesson__option${state}${gone ? ' is-eliminated' : ''}`}
              disabled={disabled || gone}
              onClick={() => {
                sfx.play('tap');
                setPicked(index);
              }}
            >
              <span className="lesson__key">{index + 1}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      {verdict ? (
        <p className="lesson__note">
          In the passage: “<LookupText as="span" text={exercise.evidence} />”
        </p>
      ) : null}
    </div>
  );
}

/** Turn a Vietnamese instruction into an English sentence. */
function WriteExerciseView({ exercise, disabled, hinted, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: WriteExercise }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    registerSubmit(() => (value.trim() ? checkSentence(value, exercise.answer) : null));
  }, [value, exercise.answer, registerSubmit]);
  useEffect(() => onAnswered(value.trim().length > 0), [value, onAnswered]);

  return (
    <div>
      <p className="lesson__kicker">Write the sentence</p>
      <h1 className="lesson__prompt lesson__prompt--sentence">{exercise.instruction}</h1>
      {exercise.hint ? <p className="lesson__hint muted">{exercise.hint}</p> : null}
      <textarea
        ref={inputRef}
        className="lesson__textarea"
        rows={3}
        value={value}
        disabled={disabled}
        placeholder="Type the English sentence…"
        onChange={(event) => setValue(event.target.value)}
      />
      {hinted ? <p className="lesson__note">Hint: your sentence starts “{revealPrefix(exercise.answer).replace(/_/g, '…')}”</p> : null}
      {verdict && !verdict.correct ? (
        <p className="lesson__note">
          Model answer: <LookupText as="span" text={exercise.answer} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * Answer a question aloud, then compare with a model.
 *
 * Nothing here grades speech — the learner judges their own answer against the
 * model, and that judgement is what is scored. Pretending otherwise would put a
 * number on the screen that means nothing.
 */
function SpeakExerciseView({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: SpeakExercise }) {
  const [revealed, setRevealed] = useState(false);
  const [said, setSaid] = useState<boolean | null>(null);
  useEffect(() => {
    registerSubmit(() => (said === null ? null : { correct: said }));
  }, [said, registerSubmit]);
  useEffect(() => onAnswered(said !== null), [said, onAnswered]);

  return (
    <div>
      <p className="lesson__kicker">Answer out loud</p>
      <h1 className="lesson__prompt lesson__prompt--sentence">
        <LookupText as="span" text={exercise.question} />
      </h1>
      <div className="row">
        {canSpeak() ? (
          <Button size="sm" onClick={() => speak(exercise.question, 0.85)}>
            <Icon name="play" size={13} /> Hear it
          </Button>
        ) : null}
        {!revealed ? (
          <Button
            size="sm"
            onClick={() => {
              sfx.play('reveal');
              setRevealed(true);
            }}
          >
            Show model answer
          </Button>
        ) : null}
      </div>
      {exercise.cue ? <p className="lesson__hint muted">A good answer covers: {exercise.cue}</p> : null}
      {revealed ? (
        <>
          <div className="lesson__sample">
            <LookupText as="span" text={exercise.sample} />
          </div>
          <p className="lesson__retry">Did you say something like this?</p>
          <div className="lesson__options" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={said === true}
              className={`lesson__option${said === true ? ' is-picked' : ''}${disabled && verdict ? (said === true ? ' is-right' : '') : ''}`}
              disabled={disabled}
              onClick={() => {
                sfx.play('select');
                setSaid(true);
              }}
            >
              <span className="lesson__key">1</span>
              <span>Yes, roughly</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={said === false}
              className={`lesson__option${said === false ? ' is-picked' : ''}${disabled && verdict ? (said === false ? ' is-wrong' : ' is-right') : ''}`}
              disabled={disabled}
              onClick={() => {
                sfx.play('select');
                setSaid(false);
              }}
            >
              <span className="lesson__key">2</span>
              <span>Not yet</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function useLessonSeed(prefix: string): [string, () => void] {
  const [salt, setSalt] = useState(() => Date.now().toString(36));
  const seed = useMemo(() => `${prefix}:${salt}`, [prefix, salt]);
  return [seed, () => setSalt(Date.now().toString(36))];
}

// Keep the mood type exported for callers that want to drive the mascot directly.
export type { MascotMood };
