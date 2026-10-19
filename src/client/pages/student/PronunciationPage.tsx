import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { learnApi } from '../../lib/learn-api';
import { speak, speakWithServer, listServerVoices, getPreferredAccent, setPreferredAccent, type SpeechAccent } from '../../lib/speech';
import { detectSpeechRecognition, finalTranscriptOf, getSpeechRecognition, type SpeechRecognitionLike } from '../../lib/dictation';
import { DICTATION_SETS, compareDictation, ipaStress, normaliseDictationToken, type DictationSentence } from '@shared/dictation';

const STOP = new Set(
  'the a an and or but so because if when while that this these those i you he she it we they my your his her its our their is are was were be been am do does did have has had to of in on at for with from by about as not no very really just also too can could would should will may might there here what which who whom whose'.split(
    ' ',
  ),
);

interface WordInfo {
  word: string;
  phonetic: string;
  level: string;
  state: 'LOADING' | 'READY' | 'MISSING';
}

/**
 * #3 Pronunciation coach (V1).
 *
 * V1 is deliberately transcript-based: the dictionary supplies IPA and the
 * primary-stress marker, and the learner can shadow the line and compare the
 * words the browser heard. Individual phonemes are not scored — that needs an
 * audio model — and the page states the limit instead of pretending.
 */
export function PronunciationPage() {
  const [setId, setSetId] = useState(DICTATION_SETS[0]!.id);
  const [index, setIndex] = useState(0);
  const [accent, setAccent] = useState<SpeechAccent>(getPreferredAccent());
  const [serverVoices, setServerVoices] = useState<string[]>([]);
  const [words, setWords] = useState<WordInfo[]>([]);
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported] = useState(() => detectSpeechRecognition());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const cacheRef = useRef(new Map<string, { phonetic: string; level: string }>());

  const set = DICTATION_SETS.find((item) => item.id === setId) ?? DICTATION_SETS[0]!;
  const sentence: DictationSentence = set.sentences[Math.min(index, set.sentences.length - 1)]!;

  const sentenceWords = useMemo(() => {
    const unique: string[] = [];
    for (const token of sentence.text.split(/\s+/)) {
      const word = normaliseDictationToken(token);
      if (word.length < 3 || STOP.has(word) || /^\d+$/.test(word)) continue;
      if (!unique.includes(word)) unique.push(word);
    }
    return unique.slice(0, 10);
  }, [sentence.text]);

  useEffect(() => {
    void listServerVoices().then(setServerVoices);
  }, []);

  useEffect(() => {
    let alive = true;
    setWords(sentenceWords.map((word) => ({ word, phonetic: '', level: '', state: 'LOADING' })));
    void (async () => {
      const next: WordInfo[] = [];
      for (const word of sentenceWords) {
        const cached = cacheRef.current.get(word);
        if (cached) {
          next.push({ word, phonetic: cached.phonetic, level: cached.level, state: cached.phonetic ? 'READY' : 'MISSING' });
          continue;
        }
        try {
          const { entry } = await learnApi.lookup(word);
          const info = { phonetic: entry.phonetic ?? '', level: entry.level ?? '' };
          cacheRef.current.set(word, info);
          next.push({ word, phonetic: info.phonetic, level: info.level, state: info.phonetic ? 'READY' : 'MISSING' });
        } catch {
          next.push({ word, phonetic: '', level: '', state: 'MISSING' });
        }
        if (alive) setWords(next.slice());
      }
      if (alive) setWords(next);
    })();
    return () => {
      alive = false;
    };
  }, [sentenceWords]);

  useEffect(() => {
    setChecked(false);
    setTyped('');
  }, [index, setId]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
    };
  }, []);

  const playSentence = async (slow = false) => {
    if (serverVoices.length > 0) await speakWithServer(sentence.text, serverVoices[0]!, accent);
    else await speak(sentence.text, slow ? 0.65 : 0.92, null, accent);
  };

  const playWord = (word: string) => {
    void speak(word, 0.8, null, accent);
  };

  const changeAccent = (next: SpeechAccent) => {
    setAccent(next);
    setPreferredAccent(next);
  };

  const toggleListening = () => {
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

  const comparison = checked ? compareDictation(sentence.text, typed) : null;
  const tricky = words.filter((word) => word.state === 'MISSING');

  return (
    <div className="stack pron-page">
      <div className="page-head">
        <div>
          <h1>Pronunciation coach</h1>
          <p className="page-head__meta">
            IPA and word stress from the dictionary, plus a shadowing check on what your browser hears. V1 works from the
            transcript: it cannot score individual sounds.
          </p>
        </div>
        <Badge tone="accent">IPA · stress · shadowing</Badge>
      </div>

      <div className="pron-controls">
        <label className="dl-select">
          <span>Line</span>
          <select
            value={`${setId}:${index}`}
            onChange={(event) => {
              const [nextSet, nextIndex] = event.target.value.split(':');
              if (nextSet) setSetId(nextSet);
              setIndex(Number(nextIndex) || 0);
            }}
          >
            {DICTATION_SETS.map((item) =>
              item.sentences.map((line, lineIndex) => (
                <option key={line.id} value={`${item.id}:${lineIndex}`}>
                  {item.title} · {lineIndex + 1}
                </option>
              )),
            )}
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
        <Button variant="primary" onClick={() => void playSentence(false)}>
          <Icon name="play" size={15} /> Hear the line
        </Button>
        <Button variant="secondary" onClick={() => void playSentence(true)}>
          <Icon name="rotate" size={15} /> Slow
        </Button>
      </div>

      <Card title="Words worth rehearsing" hint="Tap a word to hear it; IPA comes from the dictionary">
        <div className="pron-words">
          {words.map((word) => {
            const stress = word.phonetic ? ipaStress(word.phonetic) : null;
            return (
              <button
                key={word.word}
                type="button"
                className={`pron-word ${stress?.hasStressMark ? 'has-stress' : ''}`}
                onClick={() => playWord(word.word)}
                title="Hear this word"
              >
                <span className="pron-word__term">{word.word}</span>
                <span className="pron-word__ipa">
                  {word.state === 'LOADING' ? '…' : word.phonetic || 'no IPA'}
                </span>
                {stress?.hasStressMark ? (
                  <span className="pron-word__stress">stress: {stress.stressedSyllable}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          Primary stress is the syllable after the ˈ mark. {tricky.length > 0 ? `${tricky.length} word(s) have no dictionary IPA here; the dictionary may still load them on another attempt.` : ''}
        </p>
      </Card>

      <Card title="Shadow the line" hint="Listen once, then say it back without reading">
        <div className="dl-play">
          {speechSupported ? (
            <Button variant={listening ? 'danger' : 'primary'} onClick={toggleListening}>
              <Icon name="mic" size={15} /> {listening ? 'Stop and compare' : 'Record my attempt'}
            </Button>
          ) : (
            <span className="tiny muted">This browser cannot transcribe speech. Use dictation in the lab instead.</span>
          )}
          <Button variant="ghost" disabled={!typed.trim()} onClick={() => setChecked(true)}>
            Compare words
          </Button>
        </div>
        <textarea
          className="pron-answer"
          rows={3}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setChecked(false);
          }}
          placeholder="The words your browser heard will appear here — or type what you said."
        />
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          <Icon name="info" size={12} /> A word missing here may be a recognition error rather than a pronunciation error.
          Use a teacher’s ear for the final judgement.
        </p>
      </Card>

      {comparison ? (
        <Card title={`Shadowing check · ${comparison.accuracy}%`} hint={`${comparison.matched}/${comparison.total} target words recognised`}>
          <div className="dl-target">
            {comparison.words.map((word, wordIndex) => (
              <span key={`${word.target}-${wordIndex}`} className={word.matched ? 'is-ok' : 'is-missed'}>
                {word.target}
              </span>
            ))}
          </div>
          {comparison.missing.length > 0 ? (
            <p className="small muted">
              Work on: <b>{comparison.missing.slice(0, 8).join(', ')}</b>
            </p>
          ) : (
            <p className="small muted">Every target word was recognised. Now try it at natural speed.</p>
          )}
          <p className="tiny muted">
            In V1 the check is word-level. Phoneme scoring needs an audio model and is not claimed here.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
