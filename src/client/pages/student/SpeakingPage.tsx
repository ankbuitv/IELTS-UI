import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, Loading, Notice, TextArea, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { formatBand, formatDateTime } from '../../lib/format';
import { BAND_DESCRIPTORS_NOTE } from '@shared/ai-rubric';
import { SPEAKING_PART_META } from '@shared/speaking';

/**
 * Speaking practice with an AI examiner.
 *
 * How it works, and why it is honest about it:
 *  - the candidate records each part with the browser's microphone;
 *  - if the browser can transcribe speech (Web Speech API), a live transcript is
 *    captured and sent with the recording — this is what the AI grades;
 *  - if it cannot, the candidate can type what they said, or a staff member can
 *    run speech-to-text server-side with a configured provider;
 *  - the AI produces an ESTIMATED band plus criterion-by-criterion feedback. It
 *    never claims to have heard pronunciation from a transcript, and a teacher
 *    can always listen to the recording and override.
 */

interface SpeakingCatalogTopic {
  id: string;
  title: string;
  summary: string;
  partCount: number;
}

interface SpeakingPartResponse {
  part: number;
  promptText: string;
  transcript: string;
  durationSeconds: number;
  words: number;
  hasAudio: boolean;
}

interface SpeakingCriterion {
  key: string;
  label: string;
  band: number | null;
  comment: string;
}

interface SpeakingScore {
  band: number | null;
  criteria: SpeakingCriterion[];
  feedback: string;
  strengths: string[];
  improvements: string[];
  corrections: Array<{ original: string; suggestion: string; reason: string }>;
  notes: string[];
  providerModel: string;
}

interface SpeakingSessionPayload {
  session: {
    id: string;
    status: 'IN_PROGRESS' | 'SUBMITTED' | 'MARKED' | 'FAILED';
    topicTitle: string;
    overallBand: number | null;
    feedback: string;
    createdAt: string;
    markedAt: string | null;
    providerModel: string | null;
  };
  topic: {
    id: string;
    title: string;
    part1: string[];
    part2: { cue: string; bullets: string[] };
    part3: string[];
  } | null;
  responses: SpeakingPartResponse[];
  score: SpeakingScore | null;
}

interface SessionSummary {
  id: string;
  topicTitle: string;
  status: string;
  overallBand: number | null;
  createdAt: string;
  markedAt: string | null;
}

export function SpeakingPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  return sessionId ? (
    <SpeakingSessionView sessionId={sessionId} />
  ) : (
    <SpeakingLobby onStarted={(id) => navigate(`/speaking/${id}`)} />
  );
}

// ---------------------------------------------------------------------------
// Lobby: pick a topic or resume a session
// ---------------------------------------------------------------------------
function SpeakingLobby({ onStarted }: { onStarted: (sessionId: string) => void }) {
  const toast = useToast();
  const [starting, setStarting] = useState<string | null>(null);
  const topics = useAsync<{ topics: SpeakingCatalogTopic[] }>(() => api.get('/api/speaking/catalog'), []);
  const history = useAsync<{ sessions: SessionSummary[] }>(() => api.get('/api/speaking/sessions'), []);

  const start = async (topicSetId?: string) => {
    setStarting(topicSetId ?? 'custom');
    try {
      const payload = await api.post<SpeakingSessionPayload>('/api/speaking/sessions', {
        ...(topicSetId ? { topicSetId } : {}),
        mode: 'PRACTICE',
      });
      onStarted(payload.session.id);
    } catch (error) {
      toast.push(describeError(error), 'error');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Speaking practice</h1>
          <p className="page-head__meta">
            Record a full three-part speaking test and get an instant <strong>estimated</strong> band with
            criterion-by-criterion feedback. Your recording stays private to you and your teacher.
          </p>
        </div>
        <Badge tone="accent">3 parts · ~11 minutes</Badge>
      </div>

      <Notice tone="info" title="Cách chấm điểm">
        <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
          <li>Ghi âm bằng micro của trình duyệt; bật “bản chép lời” để AI chấm nội dung bạn nói.</li>
          <li>AI chấm 4 tiêu chí, nhưng phát âm chỉ được chấm khi có người nghe lại bản ghi.</li>
          <li>Điểm AI là ước lượng để học, không phải điểm thi chính thức.</li>
        </ul>
      </Notice>

      {topics.loading ? <Loading label="Đang tải chủ đề…" /> : null}
      {topics.error ? <Notice tone="danger">{topics.error}</Notice> : null}

      <div className="speaking-topic-grid">
        {(topics.data?.topics ?? []).map((topic) => (
          <button
            key={topic.id}
            type="button"
            className="topic-card"
            onClick={() => void start(topic.id)}
            disabled={starting !== null}
          >
            <span className="topic-card__title">{topic.title}</span>
            <span className="topic-card__summary">{topic.summary}</span>
            <span className="topic-card__meta">
              <Badge tone="neutral">Part 1 · 2 · 3</Badge>
              {starting === topic.id ? <Badge tone="accent">Đang tạo…</Badge> : null}
            </span>
          </button>
        ))}
      </div>

      <Card title="Chủ đề ngẫu nhiên" hint="Không chọn gì cả — hệ thống sẽ lấy một bộ đề bất kỳ.">
        <Button variant="secondary" loading={starting === 'custom'} onClick={() => void start()}>
          <Icon name="wand" size={15} /> Bắt đầu với đề ngẫu nhiên
        </Button>
      </Card>

      <Card title="Lịch sử luyện nói" hint="Mỗi lần luyện được lưu lại cùng bản chép lời và nhận xét.">
        {history.loading ? <Loading label="Đang tải…" /> : null}
        {history.data && history.data.sessions.length === 0 ? (
          <EmptyState title="Chưa có buổi luyện nói nào">Chọn một chủ đề ở trên để bắt đầu.</EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {(history.data?.sessions ?? []).map((session) => (
              <div key={session.id} className="row row--between" style={{ gap: 10 }}>
                <div>
                  <Link to={`/speaking/${session.id}`} style={{ fontWeight: 620 }}>
                    {session.topicTitle}
                  </Link>
                  <div className="tiny muted">
                    {formatDateTime(session.createdAt)} ·{' '}
                    {session.status === 'MARKED' ? 'đã chấm' : session.status === 'SUBMITTED' ? 'đã nộp' : 'đang làm'}
                  </div>
                </div>
                <Badge tone={session.overallBand === null ? 'neutral' : 'success'}>
                  {session.overallBand === null ? '—' : `~${formatBand(session.overallBand)}`}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session: record the three parts, then submit for AI marking
// ---------------------------------------------------------------------------
function SpeakingSessionView({ sessionId }: { sessionId: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync<SpeakingSessionPayload>(
    () => api.get(`/api/speaking/sessions/${sessionId}`),
    [sessionId],
  );
  const [activePart, setActivePart] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [savingPart, setSavingPart] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [manualTranscript, setManualTranscript] = useState('');
  const [lastRecorded, setLastRecorded] = useState<{ part: number; url: string; base64: string; mime: string } | null>(null);

  const responses = useMemo(() => data?.responses ?? [], [data]);
  const responseByPart = useMemo(() => new Map(responses.map((response) => [response.part, response])), [responses]);
  const topic = data?.topic ?? null;
  const session = data?.session ?? null;

  const partPrompts = useMemo(() => {
    if (!topic) return { 1: '', 2: '', 3: '' } as Record<number, string>;
    return {
      1: topic.part1.map((question, index) => `${index + 1}. ${question}`).join('\n'),
      2: `${topic.part2.cue}\n- ${topic.part2.bullets.join('\n- ')}`,
      3: topic.part3.map((question, index) => `${index + 1}. ${question}`).join('\n'),
    } as Record<number, string>;
  }, [topic]);

  const savePart = useCallback(
    async (part: number, payload: { transcript?: string; durationSeconds?: number; audioBase64?: string | null; mime?: string }) => {
      setSavingPart(true);
      try {
        await api.put(`/api/speaking/sessions/${sessionId}/parts/${part}`, payload);
        await reload();
        toast.push(`Đã lưu Part ${part}.`, 'success');
      } catch (saveError) {
        toast.push(describeError(saveError), 'error');
      } finally {
        setSavingPart(false);
      }
    },
    [reload, sessionId, toast],
  );

  const submit = async () => {
    setSubmitting(true);
    setAiError(null);
    try {
      const result = await api.post<SpeakingSessionPayload & { aiError: string | null }>(
        `/api/speaking/sessions/${sessionId}/submit`,
        {},
      );
      setAiError(result.aiError);
      if (result.aiError) toast.push(result.aiError, 'warning');
      else toast.push('AI đã chấm xong bài nói của bạn.', 'success');
      await reload();
    } catch (submitError) {
      toast.push(describeError(submitError), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Đang tải buổi luyện nói…" />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!data || !session) return null;

  const marked = session.status === 'MARKED' && data.score;
  const recordedParts = responses.filter((response) => response.transcript.trim() || response.hasAudio).length;
  const canSubmit = recordedParts > 0;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="page-head__meta" style={{ marginBottom: 4 }}>
            <Link to="/speaking">← Danh sách chủ đề</Link>
          </p>
          <h1>{session.topicTitle}</h1>
          <p className="page-head__meta">
            {recordedParts}/3 phần đã ghi · {session.status === 'MARKED' ? 'đã chấm bằng AI' : 'chưa chấm'}
          </p>
        </div>
        {marked ? (
          <Badge tone="success">~{formatBand(data.score?.band ?? null)}</Badge>
        ) : (
          <Button variant="primary" loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>
            <Icon name="sparkle" size={15} /> Nộp &amp; chấm bằng AI
          </Button>
        )}
      </div>

      {aiError ? (
        <Notice tone="warning" title="Chưa chấm được bằng AI">
          {aiError} Bài nói của bạn vẫn được lưu; giáo viên có thể chấm sau.
        </Notice>
      ) : null}

      {marked ? <SpeakingResult score={data.score!} responses={responses} /> : null}

      <div className="part-steps" role="tablist" aria-label="Speaking parts">
        {[1, 2, 3].map((part) => {
          const response = responseByPart.get(part);
          const done = Boolean(response && (response.transcript.trim() || response.hasAudio));
          return (
            <button
              key={part}
              type="button"
              role="tab"
              aria-selected={activePart === part}
              className={`part-step ${activePart === part ? 'is-active' : ''} ${done ? 'is-done' : ''}`}
              onClick={() => {
                setActivePart(part);
                setManualTranscript(response?.transcript ?? '');
              }}
            >
              <span className="part-step__index">{done ? <Icon name="check" size={12} strokeWidth={3} /> : part}</span>
              {SPEAKING_PART_META[part]?.label ?? `Part ${part}`}
            </button>
          );
        })}
      </div>

      <PartRecorder
        key={activePart}
        part={activePart}
        prompt={partPrompts[activePart] ?? ''}
        existingTranscript={responseByPart.get(activePart)?.transcript ?? ''}
        hasAudio={Boolean(responseByPart.get(activePart)?.hasAudio)}
        saving={savingPart}
        disabled={marked === null && session.status === 'MARKED'}
        onSave={async (payload) => {
          await savePart(activePart, payload);
          setManualTranscript(payload.transcript ?? '');
        }}
        manualTranscript={manualTranscript}
        onManualTranscript={setManualTranscript}
        onRecorded={(recorded) => setLastRecorded(recorded)}
      />

      {lastRecorded ? (
        <Card title={`Nghe lại Part ${lastRecorded.part}`} hint="Chỉ bạn và giáo viên của bạn nghe được bản ghi này.">
          <audio controls src={lastRecorded.url} style={{ width: '100%' }}>
            <track kind="captions" />
          </audio>
        </Card>
      ) : null}

      {responses.some((response) => response.hasAudio) ? (
        <Card title="Bản ghi đã lưu" hint="Dùng khi giáo viên cần nghe để chấm tiêu chí phát âm.">
          <div className="stack" style={{ gap: 10 }}>
            {responses
              .filter((response) => response.hasAudio)
              .map((response) => (
                <div key={response.part} className="row" style={{ gap: 10 }}>
                  <Badge tone="neutral">Part {response.part}</Badge>
                  <audio controls src={`/api/speaking/sessions/${sessionId}/audio/${response.part}`} style={{ flex: 1, minWidth: 200 }}>
                    <track kind="captions" />
                  </audio>
                </div>
              ))}
          </div>
        </Card>
      ) : null}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={() => navigate('/speaking')}>
          Về danh sách
        </Button>
        {!marked ? (
          <Button variant="primary" loading={submitting} disabled={!canSubmit} onClick={() => void submit()}>
            <Icon name="sparkle" size={15} /> Nộp &amp; chấm bằng AI
          </Button>
        ) : null}
      </div>

      <p className="tiny muted">{BAND_DESCRIPTORS_NOTE}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recorder for one part
// ---------------------------------------------------------------------------
function PartRecorder({
  part,
  prompt,
  existingTranscript,
  hasAudio,
  saving,
  disabled,
  onSave,
  manualTranscript,
  onManualTranscript,
  onRecorded,
}: {
  part: number;
  prompt: string;
  existingTranscript: string;
  hasAudio: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: (payload: { transcript?: string; durationSeconds?: number; audioBase64?: string | null; mime?: string }) => Promise<void>;
  manualTranscript: string;
  onManualTranscript: (value: string) => void;
  onRecorded: (recorded: { part: number; url: string; base64: string; mime: string }) => void;
}) {
  const meta = SPEAKING_PART_META[part] ?? { label: `Part ${part}`, prepSeconds: 0, speakSeconds: 120, hint: '' };
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [prepLeft, setPrepLeft] = useState(meta.prepSeconds);
  const [prepRunning, setPrepRunning] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const liveTranscriptRef = useRef('');
  const [transcribe, setTranscribe] = useState(true);
  const [levels, setLevels] = useState<number[]>(() => new Array(24).fill(3));
  const [error, setError] = useState<string | null>(null);
  const [speechSupported] = useState(() => detectSpeechRecognition());

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<{ context: AudioContext; data: Uint8Array; raf: number } | null>(null);
  const finalTranscriptRef = useRef(existingTranscript);

  useEffect(() => {
    if (!prepRunning) return;
    const interval = window.setInterval(() => {
      setPrepLeft((value) => {
        if (value <= 1) {
          window.clearInterval(interval);
          setPrepRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [prepRunning]);

  useEffect(() => {
    setPrepLeft(meta.prepSeconds);
    setElapsed(0);
    setLiveTranscript('');
    finalTranscriptRef.current = existingTranscript;
    return () => stopEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part]);

  /** Stops every media primitive this recorder started. Not memoised: it reads
   * refs only, and each render's copy is the one its own timer started. */
  function stopEverything() {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    if (analyserRef.current) {
      cancelAnimationFrame(analyserRef.current.raf);
      void analyserRef.current.context.close().catch(() => undefined);
      analyserRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    setRecording(false);
    setLevels(new Array(24).fill(3));
  }

  /** Stop the microphone and keep whatever was said as the editable transcript. */
  function stopRecording() {
    const captured = liveTranscriptRef.current;
    stopEverything();
    onManualTranscript(finalTranscriptRef.current.trim() || captured.trim());
  }

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        void blobToBase64(blob).then((base64) => {
          onRecorded({ part, url: URL.createObjectURL(blob), base64, mime: blob.type });
        });
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((value) => {
          if (value + 1 >= meta.speakSeconds) {
            stopRecording();
            return meta.speakSeconds;
          }
          return value + 1;
        });
      }, 1000);

      // Level meter (a candidate can see the microphone is actually working).
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        setLevels(Array.from({ length: 24 }, (_, index) => Math.max(3, Math.round((data[index % data.length] ?? 0) / 6))));
        analyserRef.current.raf = requestAnimationFrame(tick);
      };
      analyserRef.current = { context, data, raf: requestAnimationFrame(tick) };

      if (transcribe && speechSupported) startRecognition();
    } catch (mediaError) {
      setError(
        'Không truy cập được micro. Hãy cấp quyền micro cho trang này, hoặc dùng phần “Gõ lại câu trả lời”.',
      );
      console.error(mediaError);
    }
  };

  const startRecognition = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
        else interim += text;
      }
      const merged = `${finalTranscriptRef.current} ${interim}`.trim();
      liveTranscriptRef.current = merged;
      setLiveTranscript(merged);
    };
    recognition.onerror = () => undefined;
    recognition.onend = () => {
      // Chrome ends the stream after silence; restart while we are still recording.
      if (recorderRef.current?.state === 'recording') {
        try {
          recognition.start();
        } catch {
          // Ignore: the transcript already captured so far is kept.
        }
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Starting twice throws; the existing session keeps running.
    }
  };

  const transcript = recording ? liveTranscript : manualTranscript;

  return (
    <div className="recorder">
      <div className="recorder__head">
        <div className="recorder__prompt">
          <h2 style={{ marginBottom: 6 }}>{meta.label}</h2>
          <p className="small muted" style={{ marginBottom: 10 }}>{meta.hint}</p>
          <pre className="recorder__cue" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{prompt || '—'}</pre>
        </div>
        <div className="stack" style={{ gap: 6, minWidth: 150 }}>
          {meta.prepSeconds > 0 && !recording ? (
            <Button
              variant={prepLeft > 0 ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => {
                if (prepLeft > 0) setPrepRunning((value) => !value);
                else void start();
              }}
            >
              <Icon name="clock" size={14} />
              {prepLeft > 0 ? `Chuẩn bị ${prepLeft}s` : 'Bắt đầu nói'}
            </Button>
          ) : null}
          <label className="display-menu__toggle" style={{ fontSize: '0.8rem' }}>
            <input type="checkbox" checked={transcribe} onChange={(event) => setTranscribe(event.target.checked)} />
            <span>Bản chép lời (AI chấm)</span>
          </label>
          {!speechSupported ? (
            <span className="tiny muted">Trình duyệt này không hỗ trợ chép lời tự động — hãy gõ lại bên dưới.</span>
          ) : null}
        </div>
      </div>

      <div className="recorder__controls">
        {!recording ? (
          <button
            type="button"
            className="recorder__mic"
            onClick={() => void start()}
            disabled={disabled || saving}
            aria-label={`Bắt đầu ghi âm ${meta.label}`}
            title="Bắt đầu ghi âm"
          >
            <Icon name="mic" size={26} />
          </button>
        ) : (
          <button
            type="button"
            className="recorder__mic recorder__mic--recording"
            onClick={stopRecording}
            aria-label="Dừng ghi âm"
            title="Dừng ghi âm"
          >
            <Icon name="stop" size={24} />
          </button>
        )}

        <span className={`recorder__timer ${recording && meta.speakSeconds - elapsed <= 15 ? 'recorder__timer--danger' : ''}`}>
          {formatClock(elapsed)}
        </span>
        <span className="recorder__status">
          {recording
            ? `Đang ghi · còn ${formatClock(Math.max(0, meta.speakSeconds - elapsed))}`
            : hasAudio || existingTranscript
              ? 'Đã có bản ghi cho phần này — ghi lại sẽ thay thế.'
              : 'Nhấn micro để bắt đầu'}
        </span>
        <div className="recorder__meter" aria-hidden="true">
          {levels.map((height, index) => (
            <span key={index} className={`recorder__bar ${height > 20 ? 'recorder__bar--loud' : ''}`} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>

      {error ? <Notice tone="warning">{error}</Notice> : null}

      <div className="recorder__live" aria-live="polite">
        {transcript}
      </div>

      <label className="field grow" style={{ flex: 1 }}>
        <span className="field__label">Sửa / gõ lại lời nói (AI chấm phần này)</span>
        <TextArea
          rows={4}
          value={manualTranscript}
          onChange={(event) => onManualTranscript(event.target.value)}
          placeholder="Dán hoặc gõ lại câu trả lời của bạn nếu trình duyệt không tự chép lời…"
        />
      </label>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tiny muted">
          {manualTranscript.trim() ? `${manualTranscript.trim().split(/\s+/).length} từ` : 'Chưa có bản chép lời'}
        </span>
        <div className="row">
          <Button
            variant="ghost"
            onClick={() => {
              onManualTranscript('');
              finalTranscriptRef.current = '';
              setLiveTranscript('');
            }}
          >
            Xoá lời
          </Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() =>
              void onSave({
                transcript: manualTranscript,
                durationSeconds: elapsed,
              })
            }
          >
            Lưu Part {part}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result view
// ---------------------------------------------------------------------------
function SpeakingResult({ score, responses }: { score: SpeakingScore; responses: SpeakingPartResponse[] }) {
  return (
    <div className="stack">
      <div className="band-hero">
        <div className="band-hero__score">
          <span className="band-hero__value">{score.band === null ? '—' : formatBand(score.band)}</span>
          <span className="band-hero__label">Band ước lượng</span>
        </div>
        <div className="band-hero__body">
          <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.65 }}>{score.feedback}</p>
          <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Chấm bởi {score.providerModel || 'AI'} · nhận xét là ước lượng, không phải điểm thi chính thức.
          </p>
        </div>
      </div>

      <div className="criteria-grid">
        {score.criteria.map((criterion) => (
          <div className="criterion" key={criterion.key}>
            <div className="criterion__head">
              <span className="criterion__label">{criterion.label}</span>
              <span className="criterion__band">{criterion.band === null ? 'chưa chấm' : formatBand(criterion.band)}</span>
            </div>
            <p className="criterion__comment">{criterion.comment}</p>
          </div>
        ))}
      </div>

      <div className="grid grid--2">
        <Card title="Điểm mạnh">
          {score.strengths.length === 0 ? (
            <p className="muted small">Chưa có nhận xét riêng.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {score.strengths.map((item) => (
                <li key={item} style={{ marginBottom: 6 }}>{item}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Cần cải thiện">
          {score.improvements.length === 0 ? (
            <p className="muted small">Chưa có nhận xét riêng.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {score.improvements.map((item) => (
                <li key={item} style={{ marginBottom: 6 }}>{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {score.corrections.length > 0 ? (
        <Card title="Sửa lỗi cụ thể" hint="Nghe lại bản ghi và đọc to phần gợi ý.">
          <div className="stack" style={{ gap: 12 }}>
            {score.corrections.map((correction, index) => (
              <div className="correction-row" key={`${correction.original}-${index}`}>
                <del>{correction.original}</del>
                <ins>{correction.suggestion}</ins>
                <span className="correction-row__reason">{correction.reason}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {score.notes.length > 0 ? (
        <Notice tone="info" title="Lưu ý">
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {score.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {responses.some((response) => response.hasAudio) ? (
        <Card title="Nghe lại và tự sửa">
          <div className="stack" style={{ gap: 10 }}>
            {responses
              .filter((response) => response.hasAudio)
              .map((response) => (
                <div key={response.part} className="row" style={{ gap: 10 }}>
                  <Badge tone="neutral">Part {response.part}</Badge>
                  <span className="small">Bản ghi Part {response.part} · nghe lại ở khung phía trên</span>
                </div>
              ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } } & { length: number }>;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function detectSpeechRecognition(): boolean {
  return getSpeechRecognition() !== null;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`;
}
