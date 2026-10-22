import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { Button, Loading, Notice } from '../../components/ui';
import { detectSpeechRecognition, finalTranscriptOf, getSpeechRecognition, type SpeechRecognitionLike } from '../../lib/dictation';
import { speak } from '../../lib/speech';
import {
  SPEAKING_PARTNER_TOPICS,
  type PartnerSession,
  type PartnerSessionListItem,
  type PartnerTurn,
  type SpeakingPartnerPart,
  type SpeakingPartnerTopic,
} from '@shared/speaking-partner';

const PART_LABELS: Record<SpeakingPartnerPart, string> = {
  1: 'Part 1 · Everyday questions',
  2: 'Part 2 · Long turn',
  3: 'Part 3 · Discussion',
};

/**
 * #35 AI speaking partner: one question at a time, coaching after every answer,
 * qualitative summary at the end. Typing is always available; dictation is a
 * bonus on browsers that support the Web Speech API.
 */
export function SpeakingPartnerPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [topics, setTopics] = useState<SpeakingPartnerTopic[]>(SPEAKING_PARTNER_TOPICS);
  const [recent, setRecent] = useState<PartnerSessionListItem[]>([]);
  const [session, setSession] = useState<PartnerSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [speechSupported] = useState(() => detectSpeechRecognition());
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadRecent = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: PartnerSessionListItem[] }>('/api/student/speaking-partner/sessions');
      setRecent(data.sessions);
    } catch {
      // A missing history is not an error the learner needs to see.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await api.get<{ topics: SpeakingPartnerTopic[] }>('/api/student/speaking-partner/topics');
        if (alive && data.topics.length > 0) setTopics(data.topics);
      } catch {
        // The bundled list is the fallback; nothing to show.
      }
      await loadRecent();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadRecent]);

  useEffect(() => {
    let alive = true;
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void api
      .get<PartnerSession>(`/api/student/speaking-partner/sessions/${encodeURIComponent(sessionId)}`)
      .then((data) => {
        if (alive) setSession(data);
      })
      .catch((cause) => {
        if (alive) setError(describeError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session?.turns.length]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
    };
  }, []);

  const startTopic = async (topic: SpeakingPartnerTopic) => {
    setStarting(topic.id);
    setError(null);
    try {
      const created = await api.post<PartnerSession>('/api/student/speaking-partner/sessions', { topicId: topic.id });
      setSession(created);
      navigate(`/speaking/partner/${created.id}`);
      void loadRecent();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setStarting(null);
    }
  };

  const send = async () => {
    const content = input.trim();
    if (!content || !session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<PartnerSession>(
        `/api/student/speaking-partner/sessions/${encodeURIComponent(session.id)}/turns`,
        { content },
      );
      setSession(updated);
      setInput('');
      inputRef.current?.focus();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const wrapUp = async () => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSession(
        await api.post<PartnerSession>(
          `/api/student/speaking-partner/sessions/${encodeURIComponent(session.id)}/summary`,
          {},
        ),
      );
      void loadRecent();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleDictation = () => {
    if (listening) {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
      setListening(false);
      return;
    }
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';
    recognition.onresult = (event) => {
      const text = finalTranscriptOf(event);
      if (text) setInput((current) => `${current}${current ? ' ' : ''}${text}`.slice(0, 1500));
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  if (loading) return <Loading label="Opening your speaking partner…" />;

  const topic = session ? topics.find((item) => item.id === session.topicId) ?? null : null;
  const answered = session ? session.turns.filter((turn) => turn.role === 'CANDIDATE').length : 0;

  return (
    <div className="sp-page">
      <header className="sp-head">
        <div>
          <p className="sp-head__crumb">
            <Link to="/speaking">← Speaking practice</Link>
          </p>
          <h1>{session ? session.topicTitle : 'AI speaking partner'}</h1>
          <p className="sp-head__meta">
            {session ? (
              <>
                {PART_LABELS[session.part]} · {answered} answer{answered === 1 ? '' : 's'} so far
              </>
            ) : (
              'Rehearse one IELTS speaking part at a time. Every answer gets short coaching, and the session ends with a summary.'
            )}
          </p>
          {!session ? (
            <p className="tiny muted">
              3 new conversations a day.
            </p>
          ) : null}
        </div>
        {session ? (
          <div className="sp-head__actions">
            {session.status === 'ACTIVE' && answered > 0 ? (
              <Button variant="primary" loading={busy} onClick={() => void wrapUp()}>
                <Icon name="flag" size={15} /> Wrap up &amp; get feedback
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => navigate('/speaking/partner')}>
              New topic
            </Button>
          </div>
        ) : null}
      </header>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {!session ? (
        <div className="sp-lobby">
          <div className="sp-intro">
            <div className="sp-intro__icon">
              <Icon name="sparkle" size={20} />
            </div>
            <div>
              <strong>How it works</strong>
              <ul>
                <li>The partner asks one question at a time, like an examiner.</li>
                <li>Write your answer (or use the microphone) and get two or three notes straight away.</li>
                <li>Finish with a wrap-up: what worked, what to fix, and what to practise next.</li>
              </ul>
              <p className="sp-intro__note">
                Coaching is practice feedback, not an official IELTS band. Use a full mock in Speaking practice when you
                want a scored result.
              </p>
            </div>
          </div>

          {([1, 2, 3] as SpeakingPartnerPart[]).map((part) => (
            <section key={part} className="sp-part">
              <h2>{PART_LABELS[part]}</h2>
              <div className="sp-topics">
                {topics
                  .filter((item) => item.part === part)
                  .map((item) => (
                    <article key={item.id} className="sp-topic">
                      <h3>{item.title}</h3>
                      <p>{item.prompt}</p>
                      <p className="sp-topic__focus">
                        <Icon name="target" size={13} /> {item.focus}
                      </p>
                      <Button
                        variant="primary"
                        loading={starting === item.id}
                        disabled={starting !== null && starting !== item.id}
                        onClick={() => void startTopic(item)}
                      >
                        Start practising
                      </Button>
                    </article>
                  ))}
              </div>
            </section>
          ))}

          {recent.length > 0 ? (
            <section className="sp-recent">
              <h2>Recent rehearsals</h2>
              <ul>
                {recent.map((item) => (
                  <li key={item.id}>
                    <Link to={`/speaking/partner/${item.id}`} className="sp-recent__row">
                      <span className="sp-recent__title">{item.topicTitle}</span>
                      <span className="sp-recent__meta">
                        Part {item.part} · {item.turnCount} turns · {item.status === 'COMPLETED' ? 'finished' : 'in progress'}
                      </span>
                      <Icon name="chevronRight" size={15} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="sp-room">
          <aside className="sp-aside">
            <div className="sp-card">
              <span className="sp-card__label">Topic</span>
              <strong>{session.topicTitle}</strong>
              <p>{topic?.focus}</p>
              {topic ? (
                <ul className="sp-aside__questions">
                  {topic.followUps.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="sp-card sp-card--tip">
              <span className="sp-card__label">Answer tip</span>
              <p>
                Extend every answer: give a <b>reason</b>, then an <b>example</b>. Two sentences are enough in Part 1;
                Part 2 needs a story with a beginning and an end.
              </p>
            </div>
          </aside>

          <main className="sp-chat" aria-live="polite">
            <div className="sp-turns">
              {session.turns.map((turn) => (
                <TurnBubble key={turn.id} turn={turn} />
              ))}
              {busy ? (
                <div className="sp-typing" aria-label="The partner is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            {session.summary ? (
              <section className="sp-summary">
                <header>
                  <span className="sp-summary__icon">
                    <Icon name="award" size={20} />
                  </span>
                  <div>
                    <h2>Session summary</h2>
                    <p>{session.summary.headline}</p>
                  </div>
                </header>
                <div className="sp-summary__grid">
                  <div>
                    <h3>What worked</h3>
                    <ul>
                      {session.summary.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3>What to fix</h3>
                    <ul>
                      {session.summary.improvements.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3>Next steps</h3>
                    <ul>
                      {session.summary.nextSteps.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="sp-summary__note">
                  {session.summary.source === 'AI' ? 'Written by the AI partner. ' : 'Quick rule-based summary. '}
                  This is practice feedback, not an IELTS band.
                </p>
                <div className="sp-summary__actions">
                  <Button variant="primary" onClick={() => navigate('/speaking/partner')}>
                    Practise another topic
                  </Button>
                  <Link className="btn btn--secondary" to="/speaking">
                    Take a scored mock
                  </Link>
                </div>
              </section>
            ) : (
              <div className="sp-composer">
                <textarea
                  ref={inputRef}
                  rows={2}
                  value={input}
                  maxLength={1500}
                  placeholder="Type your answer in English…"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="sp-composer__bar">
                  <div className="sp-composer__left">
                    {speechSupported ? (
                      <button
                        type="button"
                        className={`sp-mic ${listening ? 'is-live' : ''}`}
                        aria-pressed={listening}
                        title={listening ? 'Stop dictation' : 'Dictate your answer'}
                        onClick={toggleDictation}
                      >
                        <Icon name="mic" size={16} />
                        {listening ? 'Listening…' : 'Speak'}
                      </button>
                    ) : (
                      <span className="sp-hint">Type your answer — this browser has no dictation.</span>
                    )}
                    <span className="sp-count">{input.length}/1500</span>
                  </div>
                  <Button variant="primary" loading={busy} disabled={!input.trim()} onClick={() => void send()}>
                    Send answer <Icon name="send" size={14} />
                  </Button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function TurnBubble({ turn }: { turn: PartnerTurn }) {
  if (turn.role === 'PARTNER') {
    return (
      <div className="sp-turn sp-turn--partner">
        <span className="sp-turn__avatar" aria-hidden="true">
          <Icon name="sparkle" size={14} />
        </span>
        <div className="sp-bubble sp-bubble--partner">
          <span className="sp-bubble__name">AI partner</span>
          <p>{turn.content}</p>
          <button
            type="button"
            className="sp-speak"
            title="Hear this question"
            aria-label="Hear this question"
            onClick={() => void speak(turn.content, 0.95)}
          >
            <Icon name="volume" size={14} /> Listen
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="sp-turn sp-turn--candidate">
      <div className="sp-bubble sp-bubble--candidate">
        <span className="sp-bubble__name">You</span>
        <p>{turn.content}</p>
      </div>
      {turn.feedback ? (
        <div className="sp-feedback">
          <div className="sp-feedback__head">
            <Icon name="sparkle" size={13} />
            <strong>{turn.feedback.source === 'AI' ? 'AI coach' : 'Quick check'}</strong>
            {turn.feedback.encourage ? <span>{turn.feedback.encourage}</span> : null}
          </div>
          {turn.feedback.notes.length > 0 ? (
            <ul>
              {turn.feedback.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          {turn.feedback.betterPhrase ? (
            <p className="sp-feedback__better">
              <span>Try</span> “{turn.feedback.betterPhrase}”
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
