import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Notice, Tabs } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { speak, listServerVoices, speakWithServer, getPreferredAccent, setPreferredAccent, type SpeechAccent } from '../../lib/speech';
import { detectSpeechRecognition, finalTranscriptOf, getSpeechRecognition, type SpeechRecognitionLike } from '../../lib/dictation';
import { DICTATION_SETS, compareDictation, type DictationSentence } from '@shared/dictation';

/**
 * #10 Dictation and shadowing.
 *
 * Dictation: hear a line, type it, then see exactly which words were missed.
 * Shadowing: hear a line, say it back, and compare the browser transcript with
 * the target. The comparison is word-level on purpose — a transcript cannot
 * score pronunciation, and the page says so.
 */
export function DictationLabPage() {
  const [setId, setSetId] = useState(DICTATION_SETS[0]!.id);
  const [mode, setMode] = useState<'DICTATION' | 'SHADOWING'>('DICTATION');
  const [accent, setAccent] = useState<SpeechAccent>(getPreferredAccent());
  const [serverVoices, setServerVoices] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported] = useState(() => detectSpeechRecognition());
  const [scores, setScores] = useState<number[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const set = DICTATION_SETS.find((item) => item.id === setId) ?? DICTATION_SETS[0]!;
  const sentence: DictationSentence = set.sentences[Math.min(index, set.sentences.length - 1)]!;

  useEffect(() => {
    void listServerVoices().then(setServerVoices);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [index, mode]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
    };
  }, []);

  const play = async (slow = false) => {
    setPlaying(true);
    try {
      if (serverVoices.length > 0) await speakWithServer(sentence.text, serverVoices[0]!, accent);
      else await speak(sentence.text, slow ? 0.65 : 0.92, null, accent);
    } finally {
      setPlaying(false);
    }
  };

  const comparison = checked ? compareDictation(sentence.text, typed) : null;

  const startListening = () => {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = accent === 'UK' ? 'en-GB' : accent === 'AU' ? 'en-AU' : 'en-US';
    recognition.onresult = (event) => {
      const text = finalTranscriptOf(event);
      if (text) setTyped((current) => `${current}${current ? ' ' : ''}${text}`);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setChecked(false);
    } catch {
      setListening(false);
    }
  };

  const check = () => {
    if (!typed.trim()) return;
    setChecked(true);
    const result = compareDictation(sentence.text, typed);
    setScores((current) => {
      const next = current.slice();
      next[index] = result.accuracy;
      return next;
    });
  };

  const next = () => {
    setChecked(false);
    setTyped('');
    setIndex((current) => (current + 1) % set.sentences.length);
  };

  const changeSet = (id: string) => {
    setSetId(id);
    setIndex(0);
    setTyped('');
    setChecked(false);
    setScores([]);
  };

  const changeAccent = (nextAccent: SpeechAccent) => {
    setAccent(nextAccent);
    setPreferredAccent(nextAccent);
  };

  const average = scores.length > 0 ? Math.round(scores.reduce((total, value) => total + value, 0) / scores.length) : null;

  return (
    <div className="stack dl-page">
      <div className="page-head">
        <div>
          <h1>Dictation &amp; shadowing</h1>
          <p className="page-head__meta">
            Train the words IELTS listening actually catches: numbers, spelled names, weak forms and connected speech.
            Dictation checks what you type; shadowing checks what the browser hears you say.
          </p>
        </div>
        <Badge tone="accent">{set.level} · {set.sentences.length} lines</Badge>
      </div>

      <Tabs
        value={mode}
        onChange={(value) => {
          setMode(value);
          setChecked(false);
          setTyped('');
        }}
        tabs={[
          { id: 'DICTATION', label: 'Dictation · type what you hear' },
          { id: 'SHADOWING', label: 'Shadowing · say it back' },
        ]}
      />

      <div className="dl-controls">
        <label className="dl-select">
          <span>Set</span>
          <select value={setId} onChange={(event) => changeSet(event.target.value)}>
            {DICTATION_SETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="dl-accents" role="group" aria-label="Accent">
          {(['UK', 'AU', 'US'] as SpeechAccent[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`dl-accent ${accent === item ? 'is-on' : ''}`}
              aria-pressed={accent === item}
              onClick={() => changeAccent(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="tiny muted">
          {serverVoices.length > 0 ? 'AI voice' : 'Device voice'} · line {index + 1}/{set.sentences.length}
          {average !== null ? ` · average ${average}%` : ''}
        </span>
      </div>

      <Card
        title={mode === 'DICTATION' ? 'Listen, then type exactly what you hear' : 'Listen, then repeat it aloud'}
        hint={sentence.trap}
      >
        <div className="dl-play">
          <Button variant="primary" loading={playing} onClick={() => void play(false)}>
            <Icon name="play" size={16} /> Play
          </Button>
          <Button variant="secondary" onClick={() => void play(true)}>
            <Icon name="rotate" size={15} /> Slow
          </Button>
          {mode === 'SHADOWING' && speechSupported ? (
            <Button variant={listening ? 'danger' : 'secondary'} onClick={startListening}>
              <Icon name="mic" size={15} /> {listening ? 'Stop and check' : 'Speak'}
            </Button>
          ) : null}
          {mode === 'SHADOWING' && !speechSupported ? (
            <span className="tiny muted">This browser cannot transcribe speech — use Dictation instead.</span>
          ) : null}
        </div>

        <div className="dl-answer">
          <label className="field">
            <span className="field__label">{mode === 'DICTATION' ? 'Your transcription' : 'What the browser heard'}</span>
            <textarea
              ref={inputRef}
              rows={3}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                setChecked(false);
              }}
              placeholder={mode === 'DICTATION' ? 'Type the sentence you heard…' : 'Press Speak and say the line…'}
              spellCheck={false}
            />
          </label>
          <div className="dl-actions">
            <Button variant="primary" disabled={!typed.trim() || listening} onClick={check}>
              Check
            </Button>
            <Button variant="ghost" onClick={next}>
              Next line <Icon name="chevronRight" size={15} />
            </Button>
          </div>
        </div>

        {comparison ? (
          <div className="dl-result" aria-live="polite">
            <div className="dl-score">
              <strong>{comparison.accuracy}%</strong>
              <span>
                {comparison.matched}/{comparison.total} words matched
              </span>
            </div>
            <div className="dl-target">
              {comparison.words.map((word, wordIndex) => (
                <span key={`${word.target}-${wordIndex}`} className={word.matched ? 'is-ok' : 'is-missed'}>
                  {word.target}
                </span>
              ))}
            </div>
            {comparison.missing.length > 0 ? (
              <p className="small muted">
                Missed or misheard: <b>{comparison.missing.slice(0, 8).join(', ')}</b>
              </p>
            ) : null}
            {comparison.extra.length > 0 ? (
              <p className="tiny muted">Words you added: {comparison.extra.slice(0, 8).join(', ')}</p>
            ) : null}
            <p className="tiny muted">
              {mode === 'SHADOWING'
                ? 'The browser compares words, not sounds. A missed word can be a recognition error — use the recording when you practise with a teacher.'
                : 'Punctuation and capital letters are ignored. Check the words you missed against the audio once more.'}
            </p>
          </div>
        ) : null}
      </Card>

      <div className="dl-progress">
        {set.sentences.map((item, itemIndex) => (
          <button
            key={item.id}
            type="button"
            className={`dl-dot ${itemIndex === index ? 'is-current' : ''} ${scores[itemIndex] !== undefined ? 'is-done' : ''}`}
            title={scores[itemIndex] !== undefined ? `${scores[itemIndex]}%` : `Line ${itemIndex + 1}`}
            onClick={() => {
              setIndex(itemIndex);
              setTyped('');
              setChecked(false);
            }}
          >
            {itemIndex + 1}
          </button>
        ))}
      </div>

      {!speechSupported && mode === 'SHADOWING' ? (
        <Notice tone="info" title="Shadowing needs dictation">
          Chrome, Edge and Safari expose speech recognition; Firefox does not. Dictation mode works everywhere.
        </Notice>
      ) : null}
    </div>
  );
}
