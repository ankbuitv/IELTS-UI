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
import { HEART_PRACTICE_SIZE, HEART_REFILL_AMOUNT, HINT_REMOVES_OPTIONS, boostState, heartRefillPrice } from '@shared/shop';
import { canSpeak, getPreferredVoiceURI, isServerVoice, listEnglishVoices, listServerVoices, serverVoiceOf, setPreferredVoiceURI, speak, speakWithServer } from '../../lib/speech';
import { learnApi } from '../../lib/learn-api';
import type { TranslationResult } from '@shared/learn';
import { Icon } from '../Icon';
import { Button, Modal } from '../ui';
import { Stars } from './Stars';
import { LESSON_MASCOT_VARIANTS, Mascot, MascotRow, reactionTo, type MascotMood, type MascotVariant } from './Mascot';
import { ComboBurst, Confetti, ComboBadge, FloatingAward, ScreenFlash, comboTier } from './Effects';
import { LookupHint, LookupProvider, LookupText } from './LookupText';
import { useInputLockdown } from '../../hooks/useInputLockdown';

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
 *
 * Running out of hearts is not a dead end and not a paywall. The "Out of hearts"
 * screen offers the same full row of hearts three ways: earn them back with a
 * short practice drill built from this lesson's own words (free, and the reason
 * the hearts existed), buy them outright with coins at the shelf price, or spend
 * a refill already in the bag. The drill is a real set of questions, not a
 * button — a learner who cannot pay still finishes the lesson tonight.
 *
 * Leaving mid-lesson asks first. The close button, the Escape key and a browser
 * back all open the same confirmation once any answer has been given, because
 * the progress of a lesson lives in this component and walking away drops it
 * silently; a reload or a closed tab is caught by `beforeunload` for the same
 * reason.
 *
 * The creature beside the questions changes coat as the lesson goes on (see
 * `LESSON_MASCOT_VARIANTS`): one drawing, many colours, so a long lesson does
 * not look like one long form. It sits on the left of the question at every
 * width — beside the reading passage, beside the word bank, beside the
 * microphone — and never underneath it, where it would push the answer off the
 * screen on a phone.
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
  const [flash, setFlash] = useState<{ burst: number; tone: 'good' | 'bad' | 'goal' | 'level' | 'combo' }>({ burst: 0, tone: 'good' });
  const [award, setAward] = useState<{ burst: number; amount: number; tone: 'xp' | 'coin' | 'heart' }>({ burst: 0, amount: 0, tone: 'xp' });
  const [clock, setClock] = useState(0);
  /** The "leave the lesson?" confirmation. */
  const [exitOpen, setExitOpen] = useState(false);
  /** The free practice drill that earns the hearts back. */
  const [drillOpen, setDrillOpen] = useState(false);
  /** Fired on the answer that reaches a combo milestone; the burst is keyed by it. */
  const [comboBurst, setComboBurst] = useState(0);
  const [refillBusy, setRefillBusy] = useState(false);
  const [refillError, setRefillError] = useState<string | null>(null);
  /** Bumped each time the drill opens, so a second drill is not the same five questions. */
  const [drillTurn, setDrillTurn] = useState(0);
  const retried = useRef(new Set<string>());
  // The exercise component reports its current answer here; `check` reads it.
  const submit = useRef<(() => { correct: boolean; almost?: boolean } | null) | null>(null);
  const finished = Math.min(Object.keys(outcomes).length, exercises.length);
  const total = exercises.length;
  const current = queue[index];

  const baseId = (exercise: Exercise) => exercise.id.replace(/:retry$/, '');

  /**
   * The practice drill that earns the hearts back.
   *
   * Built from this lesson's own exercises, with the ones already missed first:
   * the point of the drill is to meet the words that cost the hearts, not to
   * pass five questions the learner had already got right. `drillTurn` rotates
   * the order so a second attempt at the drill is not a memory of the first.
   */
  const drillExercises = useMemo(() => {
    const rotate = <T,>(list: T[], by: number): T[] => {
      if (list.length === 0) return list;
      const at = ((by % list.length) + list.length) % list.length;
      return [...list.slice(at), ...list.slice(0, at)];
    };
    const missed = exercises.filter((exercise) => outcomes[exercise.id] && !outcomes[exercise.id]!.firstTryCorrect);
    const missedIds = new Set(missed.map((exercise) => exercise.id));
    const rest = exercises.filter((exercise) => !missedIds.has(exercise.id));
    return [...rotate(missed, drillTurn), ...rotate(rest, drillTurn)].slice(0, HEART_PRACTICE_SIZE);
  }, [exercises, outcomes, drillTurn]);

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

  // A lesson is worked, not read: the right-click menu and the open-devtools /
  // view-source shortcuts go, on both key strokes, so the answers are not one
  // keystroke from a translation of the whole screen.
  //
  // The two harder locks are switched off here on purpose. Selection stays on
  // because a learner legitimately wants to select a word they have just met, and
  // the inspector veil stays off because a lesson is practice, not an assessment:
  // veiling a page because somebody opened a console while revising would be a
  // punishment with nothing to protect. Both are on for the live exam.
  useInputLockdown({ blockSelection: false, detectInspector: false });

  const boost = boostState(wallet?.xpBoostUntil, new Date());
  void clock; // re-render tick for the boost countdown

  const celebrate = useCallback((tone: 'good' | 'bad' | 'goal' | 'level' | 'combo', pieces?: number, perfect = false) => {
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
      if (outcome.almost) {
        sfx.play('almost');
      } else if (firstAttempt && combo + 1 >= 2) {
        sfx.play('combo', combo + 1);
      } else {
        sfx.correct();
      }
      if (firstAttempt) {
        const nextCombo = combo + 1;
        setCombo(nextCombo);
        setBestCombo((best) => Math.max(best, nextCombo));
        setAward({ burst: Date.now(), amount: 1, tone: 'xp' });
        // A milestone (5, 10, 15, 20 …) is an event, not a bigger badge: its own
        // flash, its own confetti, its own sound and a banner across the lesson.
        // It fires only on the answer that lands exactly on the tier, so a run
        // that passes through six does not fire twice.
        const tier = comboTier(nextCombo);
        if (tier) {
          celebrate('combo', tier.pieces);
          setComboBurst((value) => value + 1);
          sfx.play('comboTier');
        } else if (nextCombo >= 3) {
          celebrate('good', nextCombo % 3 === 0 ? 24 : 0);
        }
      }
      celebrate('good');
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
    if (!response?.applied) {
      setRefillError(response?.detail ?? 'That refill could not be used.');
      return;
    }
    restoreHearts();
  };

  /**
   * Hands the whole row of hearts back and puts the lesson where it stopped.
   *
   * All three ways back — the free drill, a coin purchase and a refill from the
   * bag — end here, so they cannot drift apart: the same number of hearts, the
   * same sound, the same "carry on from the question you missed" rather than a
   * fresh one.
   */
  const restoreHearts = useCallback(() => {
    setHearts(HEART_REFILL_AMOUNT);
    setDrillOpen(false);
    setRefillError(null);
    setCombo(0);
    sfx.play('heal');
    setAward({ burst: Date.now(), amount: HEART_REFILL_AMOUNT, tone: 'heart' });
    celebrate('goal', 18);
    setPhase('feedback');
    setVerdict({ correct: false });
  }, [celebrate]);

  /** Buys the hearts outright: the shelf price, no item in the bag, no detour to the shop. */
  const buyRefill = async () => {
    if (refillBusy) return;
    setRefillBusy(true);
    setRefillError(null);
    try {
      const response = await learnApi.buyHeartRefill();
      setWallet(response.state);
      sfx.play('buy');
      restoreHearts();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The refill could not be bought.';
      setRefillError(message);
      sfx.play('error');
    } finally {
      setRefillBusy(false);
    }
  };

  /**
   * Leaving the lesson.
   *
   * Once any answer has been given there is progress to lose — it lives in this
   * component and nowhere else — so the close button, Escape and the browser's
   * back all stop here first. Before the first answer there is nothing to lose
   * and the lesson simply closes: asking "are you sure?" about an empty screen
   * teaches a learner to click through the dialog that will matter later.
   */
  const started = finished > 0 || index > 0 || answered;
  const requestExit = useCallback(() => {
    if (started) setExitOpen(true);
    else onExit();
  }, [started, onExit]);

  // A reload or a closed tab is the same loss with no dialog available, so the
  // browser's own confirmation is asked for instead.
  useEffect(() => {
    if (!started) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [started]);

  // Enter checks or continues; it is the keyboard path through a whole lesson.
  // Escape asks to leave, unless a dialog is open, in which case it closes it.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (phase === 'done' || phase === 'failed' || drillOpen) return;
      event.preventDefault();
      if (exitOpen) setExitOpen(false);
      else requestExit();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [phase, drillOpen, exitOpen, requestExit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      if (exitOpen || drillOpen) return;
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
    const price = heartRefillPrice();
    const canAfford = (wallet?.coins ?? 0) >= price;
    return (
      <div className="lesson lesson--failed">
        <ScreenFlash burst={flash.burst} tone={flash.tone} />
        <div className="lesson__end">
          <Mascot
            mood="sad"
            size={150}
            variant="berry"
            message={`That is all ${MAX_HEARTS} hearts. Nothing is lost — the words will come round again.`}
            tone="bad"
          />
          <h1>Out of hearts</h1>
          <p className="muted">
            You ran out of tries on “{title}”. Your XP and coins so far are kept, and the words you missed will come back in your review. Pick
            any of these and the lesson carries on from the question you missed.
          </p>

          <div className="refill">
            <article className="refill__card refill__card--free">
              <span className="refill__badge">Free</span>
              <h2>
                <Icon name="target" size={17} /> Practise to earn them back
              </h2>
              <p>
                {HEART_PRACTICE_SIZE} quick questions from this lesson. Answer them and all {HEART_REFILL_AMOUNT} hearts come back — no coins,
                no shop, nothing to buy.
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  sfx.play('select');
                  setRefillError(null);
                  setDrillTurn((value) => value + 1);
                  setDrillOpen(true);
                }}
              >
                <Icon name="play" size={15} filled />
                Start the practice
              </Button>
            </article>

            <article className="refill__card">
              <h2>
                <Icon name="coin" size={17} /> Buy them with coins
              </h2>
              <p>
                {price} coins, straight back into the lesson. You have{' '}
                <b className={canAfford ? 'refill__have' : 'refill__short'}>{wallet ? wallet.coins : '…'}</b>.
              </p>
              <Button size="lg" variant={canAfford ? 'default' : 'ghost'} loading={refillBusy} disabled={!wallet || !canAfford} onClick={() => void buyRefill()}>
                <Icon name="cart" size={15} />
                {canAfford ? `Refill for ${price} coins` : `You need ${price - (wallet?.coins ?? 0)} more`}
              </Button>
              {!wallet ? <p className="refill__note muted">The shop is unreachable, so buying is off for this lesson.</p> : null}
            </article>

            <article className="refill__card">
              <h2>
                <Icon name="heart" size={17} filled /> Use a refill you own
              </h2>
              <p>{refills > 0 ? `${refills} in your bag, ready to spend.` : 'None in your bag. The shop sells them, or practise above.'}</p>
              <Button size="lg" variant="ghost" loading={busyItem} disabled={refills === 0} onClick={() => void spendRefill()}>
                <Icon name="heart" size={15} filled />
                {refills > 0 ? `Use one (${refills} left)` : 'No refills left'}
              </Button>
            </article>
          </div>

          {refillError ? (
            <p className="lesson__line lesson__line--warn" role="alert">
              {refillError}
            </p>
          ) : null}

          <div className="lesson__end-actions">
            <Button size="lg" onClick={onRestart}>
              <Icon name="rotate" size={15} />
              Try the lesson again
            </Button>
            <Button size="lg" variant="ghost" onClick={onExit}>
              <Icon name="chevronRight" size={15} className="icon--flip" />
              Back to the path
            </Button>
          </div>
        </div>

        {drillOpen ? (
          <HeartDrill
            exercises={drillExercises}
            hearts={HEART_REFILL_AMOUNT}
            onDone={restoreHearts}
            onCancel={() => {
              sfx.play('whoosh');
              setDrillOpen(false);
            }}
          />
        ) : null}
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
            variant="gold"
            message={
              perfect
                ? 'A perfect run. Every answer right first time — that is a lesson finished properly.'
                : 'Lesson finished. Every exercise ended up right, which is what counts.'
            }
            tone="good"
          />
          {/* The coats this lesson wore, in a row: the learner has just met all of
              them, and a crowd reads as a celebration where one creature reads as
              a comment. */}
          <MascotRow variants={LESSON_MASCOT_VARIANTS.slice(0, 5)} size={44} mood={perfect ? 'wow' : 'happy'} className="lesson__crowd" />
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
  // One coat per question, cycling the flock: the lesson changes colour as it
  // goes without ever drawing a second creature. A retry keeps the coat of the
  // question it is retrying, so the repeat reads as the same thing.
  const questionNumber = current ? Math.max(0, exercises.findIndex((exercise) => exercise.id === baseId(current))) : 0;
  const mascotVariant: MascotVariant = legendary
    ? 'gold'
    : (LESSON_MASCOT_VARIANTS[questionNumber % LESSON_MASCOT_VARIANTS.length] ?? 'sprout');
  // A prop that follows the kind of work: reading gets the book, listening the
  // headphones, speaking the pencil, and a retry the thinking cap.
  const mascotAccessory = isRetry
    ? 'cap'
    : current?.kind === 'read' || current?.kind === 'paraphrase'
      ? 'book'
      : current?.kind === 'listen'
        ? 'headphones'
        : current?.kind === 'write' || current?.kind === 'speak'
          ? 'pencil'
          : 'none';

  return (
    <LookupProvider enabled={!legendary}>
      <div className={`lesson lesson--${phase}`}>
        <ScreenFlash burst={flash.burst} tone={flash.tone} />
        <ComboBurst combo={combo} burst={comboBurst} />
        <header className="lesson__top">
          <button type="button" className="lesson__close" onClick={requestExit} aria-label="Leave the lesson">
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
          {wallet && !legendary ? (
            <span className="lesson__coins" title="Coins">
              <Icon name="coin" size={14} /> {wallet.coins}
            </span>
          ) : null}
          {boost.active ? (
            <span className="lesson__boost" title={`Double XP for ${boost.minutesLeft} more minutes`}>
              <Icon name="bolt" size={12} filled /> ×2 · {boost.minutesLeft}m
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
            <p className="lesson__legendary">
              <Icon name="star" size={13} filled /> Legendary — harder set. Look-ups are off; answer from memory.
            </p>
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
              {/*
                The creature is a column, not a caption. It sits on the left of
                every exercise kind — reading passage, word bank, microphone
                alike — and stays there as the page scrolls; a mascot that moves
                under the question pushes the answers off a phone screen.
              */}
              <div className="lesson__mascot lesson__mascot--side">
                <Mascot
                  mood={phase === 'feedback' ? reaction.mood : isRetry ? 'think' : 'idle'}
                  size={104}
                  variant={mascotVariant}
                  accessory={mascotAccessory}
                  message={phase === 'feedback' ? reaction.message : isRetry ? 'This one again — you know it now.' : undefined}
                  tone={reaction.tone}
                />
              </div>
              <div className="lesson__body">
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

        <Modal
          open={exitOpen}
          title="Leave this lesson?"
          onClose={() => setExitOpen(false)}
          actions={
            <>
              <Button size="lg" variant="ghost" onClick={() => setExitOpen(false)}>
                Keep going
              </Button>
              <Button
                size="lg"
                variant="danger"
                onClick={() => {
                  setExitOpen(false);
                  onExit();
                }}
              >
                <Icon name="exit" size={15} />
                Leave anyway
              </Button>
            </>
          }
        >
          <div className="exit-ask">
            <Mascot mood="think" size={92} variant={mascotVariant} />
            <p>
              You have answered <b>{finished}</b> of <b>{total}</b> question{total === 1 ? '' : 's'}. A lesson only pays when it is finished, so
              leaving now drops this run — the words you missed will still come back in your review, but the XP and coins from these answers
              will not.
            </p>
          </div>
        </Modal>
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
 *
 * When no provider answers, the word's gloss is still shown — it is the part a
 * learner can always have — and the missing sentence translation is *not*
 * announced in the middle of the answer panel. It used to print "The translation
 * service is off… Turn on a provider in Admin → AI" under every single question,
 * which is an administrator's configuration note dropped into a learner's
 * lesson, repeated forty times an hour. It is now one short line, in the
 * learner's language, and the administrator's version lives where an
 * administrator will see it: a notice on the Learn page, shown only to a role
 * that can do something about it.
 */
function FeedbackTranslation({ sentence, explain }: { sentence: string; explain: Exercise['explain'] }) {
  const translation = useSentenceTranslation(sentence, Boolean(sentence));
  const hasWord = Boolean(explain.term && explain.meaning);
  const off = Boolean(translation && !translation.available);

  return (
    <div className="lesson__translation">
      {sentence ? (
        <p className={`lesson__vi${off ? ' lesson__vi--empty' : ''}`}>
          <span className="lesson__vi-label">Nghĩa cả câu</span>
          {translation === null ? <em className="lesson__vi-loading">đang dịch…</em> : null}
          {translation?.available ? <span lang="vi">{translation.vi}</span> : null}
          {off ? (
            <em className="lesson__vi-off" title="Sentence translation needs an AI provider to be switched on.">
              <Icon name="info" size={12} /> Chưa dịch được cả câu — nghĩa của từ mới vẫn ở ngay bên dưới.
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

/**
 * Match each word with its meaning.
 *
 * Judged on the finished board, not on a clean run. A slip shows its red flash
 * and the pair stays where it was, so the learner corrects themselves and
 * carries on; when every pair is finally together the answer is right, because
 * "got it wrong, then got it all right" is the thing the exercise was for. It is
 * marked `almost` when there were slips, which is the same verdict a typed
 * answer with a spelling wobble gets: counted correct, and the feedback still
 * says it was not clean.
 */
function MatchExerciseView({ exercise, disabled, hinted, registerSubmit, onAnswered }: ViewProps & { exercise: MatchExercise }) {
  const [term, setTerm] = useState<number | null>(null);
  const [solved, setSolved] = useState<number[]>([]);
  const [wrongPair, setWrongPair] = useState<[number, number] | null>(null);
  const [slips, setSlips] = useState(0);
  const complete = solved.length === exercise.pairs.length;
  // A hint points at the first pair still to be found, in both columns.
  const hintedPair = hinted ? exercise.pairs.findIndex((_, index) => !solved.includes(index)) : -1;

  useEffect(() => {
    registerSubmit(() => (complete ? { correct: true, almost: slips > 0 } : null));
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

/**
 * The free way back from "Out of hearts".
 *
 * A short lesson inside the lost one: the same question furniture, the same
 * sounds, the same creature, and no hearts to lose — a wrong answer here costs
 * nothing except another look at the same question. Finish the set and the whole
 * row of hearts comes back.
 *
 * It is deliberately *not* a formality. The questions come from the lesson the
 * learner just lost, missed ones first, so the drill is the revision the hearts
 * were trying to prompt in the first place; a learner who breezes through it has
 * earned the refill, and one who does not stays on the question until they have.
 */
function HeartDrill({
  exercises,
  hearts,
  onDone,
  onCancel,
}: {
  exercises: Exercise[];
  hearts: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'answering' | 'feedback'>('answering');
  const [verdict, setVerdict] = useState<{ correct: boolean; almost?: boolean } | null>(null);
  const [answered, setAnswered] = useState(false);
  const [misses, setMisses] = useState(0);
  const [solved, setSolved] = useState(0);
  // The exercise reports its current answer here; `check` reads it.
  const submit = useRef<(() => { correct: boolean; almost?: boolean } | null) | null>(null);

  const total = exercises.length;
  const current = exercises[index];
  const percent = total === 0 ? 0 : Math.round((solved / total) * 100);
  const variant: MascotVariant = LESSON_MASCOT_VARIANTS[index % LESSON_MASCOT_VARIANTS.length]!;

  // Both handlers are declared before the effect that binds them: the effect's
  // closure reads them on every keystroke, and a `const` below its own reader is
  // a temporal-dead-zone bug waiting for a re-render to reorder things.

  const check = () => {
    if (phase !== 'answering') return;
    const outcome = submit.current?.();
    if (!outcome) return;
    setVerdict(outcome);
    setPhase('feedback');
    if (outcome.correct) {
      sfx.correct();
      setSolved((value) => value + 1);
      window.setTimeout(() => sfx.play('reveal'), 200);
    } else {
      sfx.incorrect();
      setMisses((value) => value + 1);
    }
  };

  const next = () => {
    if (!verdict?.correct) {
      // A miss repeats the same question with a fresh mount, so the answer the
      // learner just gave is cleared rather than sitting there marked wrong.
      sfx.play('whoosh');
      setAttempt((value) => value + 1);
      setPhase('answering');
      setVerdict(null);
      setAnswered(false);
      return;
    }
    if (index + 1 >= total) {
      sfx.play('heal');
      onDone();
      return;
    }
    sfx.play('whoosh');
    setIndex(index + 1);
    setAttempt(0);
    setPhase('answering');
    setVerdict(null);
    setAnswered(false);
  };

  useEffect(() => {
    sfx.play('lessonStart');
  }, []);

  // Enter checks, then continues — the same keyboard path as the lesson.
  // Re-bound on every render on purpose: the handler has to see this render's
  // `phase` and `answered`, and a stale one would swallow the keystroke.
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

  // An empty set has nothing to practise with. Placed after every hook so the
  // component never renders a different number of them.
  if (total === 0 || !current) {
    return (
      <div className="drill" role="dialog" aria-modal="true" aria-label="Practice to refill your hearts">
        <div className="drill__panel">
          <h2>No practice available</h2>
          <p className="muted">This lesson has no questions left to practise with. Buy a refill or start the lesson again.</p>
          <Button size="lg" variant="primary" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  const model = feedbackModel(current);
  const reaction = reactionTo(phase === 'feedback' ? verdict : null);

  return (
    <div className="drill" role="dialog" aria-modal="true" aria-label="Practice to refill your hearts">
      <div className="drill__panel">
        <header className="drill__top">
          <button type="button" className="lesson__close" onClick={onCancel} aria-label="Close the practice">
            <Icon name="close" size={20} />
          </button>
          <div className="lesson__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Practice progress">
            <div className="lesson__bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="drill__hearts" title={`All ${hearts} hearts when you finish`}>
            {Array.from({ length: hearts }, (_, heartIndex) => (
              <Icon
                key={heartIndex}
                name="heart"
                size={14}
                filled={heartIndex < solved}
                style={{ opacity: heartIndex < solved ? 1 : 0.25 }}
              />
            ))}
          </span>
        </header>

        <p className="drill__kicker">
          <Icon name="heart" size={13} filled /> Practice · question {Math.min(index + 1, total)} of {total}
        </p>
        <h2 className="drill__title">Earn the hearts back</h2>
        <p className="drill__line muted">
          No hearts to lose here. A wrong answer simply comes back until you have it — finish the set and all {hearts} return.
        </p>

        <div className="drill__stage" key={`${current.id}:${attempt}`}>
          <ExerciseView
            exercise={current}
            disabled={phase !== 'answering'}
            hinted={false}
            verdict={verdict}
            registerSubmit={(fn) => {
              submit.current = fn;
            }}
            onAnswered={setAnswered}
          />
          <div className="lesson__mascot lesson__mascot--side">
            <Mascot
              mood={phase === 'feedback' ? reaction.mood : 'think'}
              size={78}
              variant={variant}
              message={phase === 'feedback' ? reaction.message : 'One at a time. You have got this.'}
              tone={reaction.tone}
            />
          </div>
        </div>

        {phase === 'feedback' ? (
          <div className={`drill__feedback${verdict?.correct ? ' is-good' : ' is-bad'}`} role="status" aria-live="polite">
            <strong>{verdict?.correct ? (verdict.almost ? 'Almost — mind the spelling' : 'Correct') : 'Not yet'}</strong>
            <span className="lesson__answer">
              Answer: <b>{correctAnswerText(current)}</b>
            </span>
            {model.sentence ? <LookupText as="p" className="lesson__sentence" text={model.sentence} highlight={model.highlight} /> : null}
          </div>
        ) : null}

        <footer className="drill__foot">
          <span className="muted small">{misses > 0 ? `${misses} miss${misses === 1 ? '' : 'es'} — keep going.` : 'Clean so far.'}</span>
          {phase === 'feedback' ? (
            <Button variant={verdict?.correct ? 'success' : 'danger'} size="lg" onClick={next} data-keep-enter="true">
              {verdict?.correct ? (index + 1 >= total ? 'Take the hearts' : 'Continue') : 'Try it again'}
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={check} disabled={!answered}>
              Check
            </Button>
          )}
        </footer>
      </div>
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
