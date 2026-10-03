import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { canSpeak, getPreferredVoiceURI, isServerVoice, listEnglishVoices, listServerVoices, serverVoiceOf, setPreferredVoiceURI, speak, speakWithServer } from '../../lib/speech';
import { Icon } from '../Icon';
import { Button } from '../ui';
import { Stars } from './Stars';

/**
 * The lesson player: one exercise at a time, a progress bar, five hearts and a
 * feedback bar that says what the right answer was and why.
 *
 * A wrong answer costs a heart and the exercise comes back once at the end, so
 * the learner finishes by getting everything right. Accuracy for XP counts only
 * first tries. Losing every heart ends the lesson with nothing earned.
 */
type Phase = 'answering' | 'feedback' | 'done' | 'failed';

interface Outcome {
  terms: string[];
  firstTryCorrect: boolean;
}

export function LessonPlayer({
  title,
  exercises,
  onExit,
  onFinish,
  onRestart,
}: {
  title: string;
  exercises: Exercise[];
  onExit: () => void;
  onFinish: (score: LessonScore) => Promise<LessonFinish>;
  onRestart: () => void;
}) {
  const [queue, setQueue] = useState<Exercise[]>(exercises);
  const [index, setIndex] = useState(0);
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [phase, setPhase] = useState<Phase>('answering');
  const [verdict, setVerdict] = useState<{ correct: boolean; almost?: boolean } | null>(null);
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState<LessonFinish | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const retried = useRef(new Set<string>());
  // The exercise component reports its current answer here; `check` reads it.
  const submit = useRef<(() => { correct: boolean; almost?: boolean } | null) | null>(null);

  const total = exercises.length;
  const current = queue[index];
  const finished = Math.min(Object.keys(outcomes).length, total);

  const baseId = (exercise: Exercise) => exercise.id.replace(/:retry$/, '');

  const finish = useCallback(
    async (score: LessonScore) => {
      setSaving(true);
      setSaveError(null);
      try {
        setResult(await onFinish(score));
        setPhase('done');
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Your progress could not be saved.');
        setPhase('done');
      } finally {
        setSaving(false);
      }
    },
    [onFinish],
  );

  const check = () => {
    if (!current || phase !== 'answering') return;
    const outcome = submit.current?.();
    if (!outcome) return;
    const id = baseId(current);
    if (!(id in outcomes)) setOutcomes((previous) => ({ ...previous, [id]: { terms: current.terms, firstTryCorrect: outcome.correct } }));
    if (!outcome.correct) {
      const left = hearts - 1;
      setHearts(left);
      if (!retried.current.has(id)) {
        retried.current.add(id);
        setQueue((previous) => [...previous, { ...current, id: `${id}:retry` }]);
      }
      setVerdict(outcome);
      setPhase(left <= 0 ? 'failed' : 'feedback');
      return;
    }
    setVerdict(outcome);
    setPhase('feedback');
  };

  const next = () => {
    if (index + 1 >= queue.length) {
      void finish(scoreLesson(Object.values(outcomes)));
      return;
    }
    setIndex(index + 1);
    setPhase('answering');
    setVerdict(null);
    setAnswered(false);
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

  if (phase === 'failed') {
    return (
      <div className="lesson">
        <div className="lesson__end">
          <div className="lesson__end-mark lesson__end-mark--bad" aria-hidden="true">
            <Icon name="close" size={32} strokeWidth={3} />
          </div>
          <h1>Out of hearts</h1>
          <p className="muted">You ran out of tries on “{title}”. Nothing was lost; the words you missed will be easier next time.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" size="lg" onClick={onRestart}>
              Try the lesson again
            </Button>
            <Button size="lg" onClick={onExit}>
              Back to the path
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const score = scoreLesson(Object.values(outcomes));
    return (
      <div className="lesson">
        <div className="lesson__end">
          <div className="lesson__end-mark" aria-hidden="true">
            <Icon name="check" size={34} strokeWidth={3.2} />
          </div>
          <h1>{score.correct === score.total ? 'Perfect lesson' : 'Lesson complete'}</h1>
          <p className="muted">{title}</p>
          <dl className="lesson__stats">
            <div>
              <dt>XP</dt>
              <dd>{result ? `+${result.xpGained}` : '—'}</dd>
            </div>
            <div>
              <dt>First-try</dt>
              <dd>{score.total ? Math.round((score.correct / score.total) * 100) : 0}%</dd>
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
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
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

  return (
    <div className="lesson">
      <header className="lesson__top">
        <button type="button" className="lesson__close" onClick={onExit} aria-label="Leave the lesson">
          <Icon name="close" size={20} />
        </button>
        <div className="lesson__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Lesson progress">
          <div className="lesson__bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="lesson__hearts" aria-label={`${hearts} hearts left`} title={`${hearts} of ${MAX_HEARTS} hearts`}>
          <Icon name="heart" size={17} />
          {hearts}
        </span>
      </header>

      <main className="lesson__main">
        {current ? (
          <div className="lesson__stage" key={current.id}>
            {isRetry ? <p className="lesson__retry">Try this one again</p> : null}
            <ExerciseView
              exercise={current}
              disabled={phase !== 'answering'}
              verdict={verdict}
              registerSubmit={(fn) => {
                submit.current = fn;
              }}
              onAnswered={setAnswered}
            />
          </div>
        ) : null}
      </main>

      <footer className={`lesson__foot${phase === 'feedback' ? (verdict?.correct ? ' lesson__foot--good' : ' lesson__foot--bad') : ''}`}>
        <div className="lesson__foot-inner">
          {phase === 'feedback' && current ? (
            <div className="lesson__feedback" role="status" aria-live="polite">
              <strong>{verdict?.correct ? (verdict.almost ? 'Almost — check the spelling' : 'Correct') : 'Not quite'}</strong>
              {!verdict?.correct || verdict?.almost ? (
                <span className="lesson__answer">
                  Answer: <b>{correctAnswerText(current)}</b>
                </span>
              ) : null}
              <span className="lesson__explain">
                <b>{current.explain.term}</b> ({current.explain.pos}) — {current.explain.meaning}
                {current.explain.vi ? ` · ${current.explain.vi}` : ''}
              </span>
            </div>
          ) : (
            <span />
          )}
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
      </footer>
    </div>
  );
}

/** What the page hands back after saving: shown on the finish screen. */
export interface LessonFinish {
  xpGained: number;
  stars?: number;
  lines: string[];
}

// ------------------------------------------------------------------ exercises
interface ViewProps {
  exercise: Exercise;
  disabled: boolean;
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

function OptionExercise({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const spoken = useRef(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [serverVoices, setServerVoices] = useState<string[]>([]);
  const [voiceURI, setVoiceURI] = useState<string | null>(getPreferredVoiceURI());
  const [audioFailed, setAudioFailed] = useState(false);
  const options = exercise.kind === 'choose' || exercise.kind === 'fill' || exercise.kind === 'listen' ? exercise.options : [];
  const answer = exercise.kind === 'choose' || exercise.kind === 'fill' || exercise.kind === 'listen' ? exercise.answer : -1;

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
      if (number >= 1 && number <= options.length) setPicked(number - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, options.length]);

  return (
    <div>
      {exercise.kind === 'choose' ? (
        <>
          <p className="lesson__kicker">Choose the meaning</p>
          <h1 className="lesson__prompt">{exercise.prompt}</h1>
        </>
      ) : null}
      {exercise.kind === 'fill' ? (
        <>
          <p className="lesson__kicker">Complete the sentence</p>
          <h1 className="lesson__prompt lesson__prompt--sentence">{exercise.sentence}</h1>
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
              This device will not play the audio. The word is “<b>{exercise.speak}</b>”.
            </p>
          ) : null}
        </>
      ) : null}
      <div className="lesson__options" role="radiogroup">
        {options.map((option, optionIndex) => {
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
              className={`lesson__option${state}`}
              disabled={disabled}
              onClick={() => setPicked(optionIndex)}
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

function TypeExerciseView({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: TypeExercise }) {
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
      <h1 className="lesson__prompt">{exercise.prompt}</h1>
      <p className="lesson__hint">
        Vietnamese: <b>{exercise.hint}</b>
      </p>
      <p className="lesson__mask" aria-label={`${exercise.answer.length} letters`}>
        {exercise.mask}
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

function OrderExerciseView({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: OrderExercise }) {
  // `chosen` holds indices into `exercise.tokens`, in the order the learner tapped them.
  const [chosen, setChosen] = useState<number[]>([]);
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
      <h1 className="lesson__prompt">{exercise.prompt}</h1>
      <div className={`lesson__line-up${disabled && verdict ? (verdict.correct ? ' is-right' : ' is-wrong') : ''}`} aria-label="Your sentence">
        {chosen.map((tokenIndex) => (
          <button
            key={tokenIndex}
            type="button"
            className="lesson__token"
            disabled={disabled}
            onClick={() => setChosen((previous) => previous.filter((item) => item !== tokenIndex))}
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
            className={`lesson__token${chosen.includes(tokenIndex) ? ' is-used' : ''}`}
            disabled={disabled || chosen.includes(tokenIndex)}
            onClick={() => setChosen((previous) => [...previous, tokenIndex])}
          >
            {token}
          </button>
        ))}
      </div>
    </div>
  );
}

function MatchExerciseView({ exercise, disabled, registerSubmit, onAnswered }: ViewProps & { exercise: MatchExercise }) {
  const [term, setTerm] = useState<number | null>(null);
  const [solved, setSolved] = useState<number[]>([]);
  const [wrongPair, setWrongPair] = useState<[number, number] | null>(null);
  const [slips, setSlips] = useState(0);
  const complete = solved.length === exercise.pairs.length;

  useEffect(() => {
    registerSubmit(() => (complete ? { correct: slips === 0 } : null));
  }, [complete, slips, registerSubmit]);
  useEffect(() => onAnswered(complete), [complete, onAnswered]);

  const pickMeaning = (pairIndex: number) => {
    if (disabled || term === null || solved.includes(pairIndex)) return;
    if (pairIndex === term) {
      setSolved((previous) => [...previous, pairIndex]);
      setTerm(null);
      setWrongPair(null);
    } else {
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
              className={`lesson__option${solved.includes(pairIndex) ? ' is-right' : term === pairIndex ? ' is-picked' : ''}${wrongPair?.[0] === pairIndex ? ' is-wrong' : ''}`}
              disabled={disabled || solved.includes(pairIndex)}
              onClick={() => setTerm(pairIndex)}
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
              className={`lesson__option lesson__option--small${solved.includes(pairIndex) ? ' is-right' : ''}${wrongPair?.[1] === pairIndex ? ' is-wrong' : ''}`}
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
function ParaphraseExerciseView({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: ParaphraseExercise }) {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    registerSubmit(() => (picked === null ? null : { correct: picked === exercise.answer }));
  }, [picked, exercise.answer, registerSubmit]);
  useEffect(() => onAnswered(picked !== null), [picked, onAnswered]);

  return (
    <div>
      <p className="lesson__kicker">Choose the sentence that means the same</p>
      <h1 className="lesson__prompt lesson__prompt--sentence">{exercise.prompt}</h1>
      <div className="lesson__options" role="radiogroup">
        {exercise.options.map((option, index) => {
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
              className={`lesson__option${state}`}
              disabled={disabled}
              onClick={() => setPicked(index)}
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
function ReadExerciseView({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: ReadExercise }) {
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    registerSubmit(() => (picked === null ? null : { correct: picked === exercise.answer }));
  }, [picked, exercise.answer, registerSubmit]);
  useEffect(() => onAnswered(picked !== null), [picked, onAnswered]);

  return (
    <div>
      <p className="lesson__kicker">Read and answer</p>
      <div className="lesson__passage">{exercise.passage}</div>
      <h1 className="lesson__prompt lesson__prompt--sentence">{exercise.stem}</h1>
      <div className="lesson__options" role="radiogroup">
        {exercise.options.map((option, index) => {
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
              className={`lesson__option${state}`}
              disabled={disabled}
              onClick={() => setPicked(index)}
            >
              <span className="lesson__key">{index + 1}</span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>
      {verdict ? <p className="lesson__note">In the passage: “{exercise.evidence}”</p> : null}
    </div>
  );
}

/** Turn a Vietnamese instruction into an English sentence. */
function WriteExerciseView({ exercise, disabled, verdict, registerSubmit, onAnswered }: ViewProps & { exercise: WriteExercise }) {
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
      {verdict && !verdict.correct ? <p className="lesson__note">Model answer: {exercise.answer}</p> : null}
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
      <h1 className="lesson__prompt lesson__prompt--sentence">{exercise.question}</h1>
      <div className="row">
        {canSpeak() ? (
          <Button size="sm" onClick={() => speak(exercise.question, 0.85)}>
            <Icon name="play" size={13} /> Hear it
          </Button>
        ) : null}
        {!revealed ? (
          <Button size="sm" onClick={() => setRevealed(true)}>
            Show model answer
          </Button>
        ) : null}
      </div>
      {exercise.cue ? <p className="lesson__hint muted">A good answer covers: {exercise.cue}</p> : null}
      {revealed ? (
        <>
          <div className="lesson__sample">{exercise.sample}</div>
          <p className="lesson__retry">Did you say something like this?</p>
          <div className="lesson__options" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={said === true}
              className={`lesson__option${said === true ? ' is-picked' : ''}${disabled && verdict ? (said === true ? ' is-right' : '') : ''}`}
              disabled={disabled}
              onClick={() => setSaid(true)}
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
              onClick={() => setSaid(false)}
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
