import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { QuestionRenderer } from '../../components/exam/QuestionRenderer';
import { AnswerExplanation, evidenceSegmentId } from '../../components/exam/AnswerExplanation';
import { TranscriptView } from '../../components/exam/TranscriptView';
import { WritingPrompt, writingTasksOf, type WritingTaskRef } from '../../components/exam/WritingEditor';
import { AiMarkPanel } from '../../components/AiMarkPanel';
import type { AttemptResultPayload } from '../../components/ResultView';
import type { CandidateSection } from '@shared/question-types';
import type { CandidateTestPayload } from '@shared/candidate';
import { formatBand, formatDateTime } from '../../lib/format';

/**
 * Review an attempt inside the exam interface itself: the same two panes, the
 * same question cards — but every question is read-only and shows your answer,
 * the accepted answer and the evidence that proves it. This is the "review lại
 * bài làm" screen.
 */
export function AttemptReviewPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();

  const resultQ = useAsync<AttemptResultPayload>(
    () => api.get(`/api/attempts/${attemptId}/result`),
    [attemptId],
  );
  const result = resultQ.data;

  // The real paper (options, groups) comes from the version preview — matched
  // to the result by questionId / sectionId.
  const testVersionId = result?.testVersionId ?? '';
  const previewQ = useAsync<{ test: CandidateTestPayload } | null>(
    async () => {
      if (!result?.testId) return null;
      const versionQuery = testVersionId ? `?versionId=${encodeURIComponent(testVersionId)}` : '';
      try {
        return await api.get(`/api/tests/${encodeURIComponent(result.testId)}/preview${versionQuery}`);
      } catch {
        return null; // prompts-only fallback below
      }
    },
    [result?.testId, testVersionId],
  );

  const sessions = result?.sessions ?? [];
  const [sessionIdx, setSessionIdx] = useState(0);
  const [speakingTab, setSpeakingTab] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /** "Listen from here": play the section recording from the evidence sentence. */
  const listenFrom = (segmentId: string | null) => {
    const segment = (activeSectionResultRef.current?.transcript?.segments ?? []).find((item) => item.id === segmentId);
    const audio = audioRef.current;
    if (audio && segment && segment.startSeconds !== null) {
      audio.currentTime = segment.startSeconds;
      void audio.play().catch(() => undefined);
    }
    if (segmentId) {
      document
        .getElementById(`transcript-segment-${segmentId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  const activeSession = sessions[sessionIdx] ?? null;
  const [sectionId, setSectionId] = useState<string | null>(null);

  const sectionsById = useMemo(() => {
    const map = new Map<string, CandidateSection>();
    for (const section of previewQ.data?.test.sections ?? []) map.set(section.id, section);
    return map;
  }, [previewQ.data]);

  const sectionResults = activeSession?.sectionResults ?? [];
  const activeSectionId = sectionId ?? sectionResults[0]?.sectionId ?? null;
  const activeSectionResult = sectionResults.find((s) => s.sectionId === activeSectionId) ?? null;
  const activeSectionResultRef = useRef<typeof activeSectionResult>(null);
  useEffect(() => {
    activeSectionResultRef.current = activeSectionResult;
  }, [activeSectionResult]);
  const activePaperSection = activeSectionId ? (sectionsById.get(activeSectionId) ?? null) : null;

  const reviewItems = useMemo(
    () =>
      (activeSession?.review ?? [])
        .filter((item) => (activeSectionId ? item.sectionId === activeSectionId : true))
        .slice()
        .sort((a, b) => a.number - b.number),
    [activeSession, activeSectionId],
  );

  const correctnessByQuestion = useMemo(() => {
    const map = new Map<string, (typeof reviewItems)[number]>();
    for (const item of activeSession?.review ?? []) map.set(item.questionId, item);
    return map;
  }, [activeSession]);

  if (resultQ.loading && !result) return <Loading label="Opening your review…" />;
  if (resultQ.error && !result) {
    return (
      <div className="stack" style={{ maxWidth: 560, margin: '60px auto' }}>
        <Notice tone="danger">{describeError(resultQ.error)}</Notice>
        <Link className="btn btn--secondary" to="/history">
          Back to results
        </Link>
      </div>
    );
  }
  if (!result) return null;

  const isWriting = activeSession?.skill === 'WRITING';
  const totalScore = `${result.rawScore ?? '—'}/${result.totalQuestions ?? '—'}`;

  return (
    <div className="exam-root exam-root--review">
      <header className="exam-topbar">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="exam-icon" onClick={() => navigate('/history')} aria-label="Back to results">
            <Icon name="chevronRight" size={16} className="icon--flip" />
          </button>
          <strong style={{ fontSize: '1.02rem' }}>{result.testTitle}</strong>
          <span className="mchip mchip--sun">
            <Icon name="eye" size={12} />
            REVIEW
          </span>
          <span className="mchip">{formatDateTime(result.submittedAt ?? result.startedAt)}</span>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mchip">
            <Icon name="chart" size={12} />
            {totalScore}
          </span>
          {result.estimatedBand !== null ? (
            <span className="mchip mchip--violet">
              <Icon name="target" size={12} />
              Band {formatBand(result.estimatedBand)}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={async () => {
              try {
                const created = await api.post<{ attemptId: string }>('/api/attempts', {
                  testId: result.testId,
                  mode: 'PRACTICE',
                });
                navigate(`/exam/${created.attemptId}`);
              } catch {
                navigate('/practice');
              }
            }}
          >
            <Icon name="rotate" size={13} />
            Thi lại
          </button>
        </div>
      </header>

      {sessions.length > 1 || result.speaking ? (
        <div className="exam-seg" role="tablist" style={{ margin: '10px 16px 0' }}>
          {sessions.map((session, index) => (
            <button
              key={session.skillSessionId}
              type="button"
              role="tab"
              aria-selected={!speakingTab && index === sessionIdx}
              className={`exam-seg__btn ${!speakingTab && index === sessionIdx ? 'is-on' : ''}`}
              onClick={() => {
                setSpeakingTab(false);
                setSessionIdx(index);
                setSectionId(null);
              }}
            >
              {session.label || session.skill}
            </button>
          ))}
          {result.speaking ? (
            <button
              type="button"
              role="tab"
              aria-selected={speakingTab}
              className={`exam-seg__btn ${speakingTab ? 'is-on' : ''}`}
              onClick={() => setSpeakingTab(true)}
            >
              Speaking
            </button>
          ) : null}
        </div>
      ) : null}

      {sectionResults.length > 1 ? (
        <div className="exam-seg" role="tablist" style={{ margin: '10px 16px 0' }}>
          {sectionResults.map((section) => (
            <button
              key={section.sectionId}
              type="button"
              role="tab"
              aria-selected={section.sectionId === activeSectionId}
              className={`exam-seg__btn ${section.sectionId === activeSectionId ? 'is-on' : ''}`}
              onClick={() => setSectionId(section.sectionId)}
            >
              {section.label || section.title || 'Section'}
            </button>
          ))}
        </div>
      ) : null}

      {speakingTab && result.speaking ? (
        <SpeakingReview sessionId={result.speaking.sessionId} />
      ) : isWriting ? (
        <WritingReview session={activeSession} sections={previewQ.data?.test.sections ?? []} />
      ) : (
        <SplitPanes
          share={46}
          left={
            <div className="exam-pane__scroll">
              {activeSectionResult?.passage ? (
                <article className="passage-article">
                  <div className="passage-article__head">
                    <h2>{activeSectionResult.passage.title || activeSectionResult.title}</h2>
                    <span className="tiny muted nowrap">{activeSectionResult.passage.wordCount} words</span>
                  </div>
                  {activeSectionResult.passage.subtitle ? (
                    <p className="muted small">{activeSectionResult.passage.subtitle}</p>
                  ) : null}
                  <div className="passage">
                    {activeSectionResult.passage.paragraphs.map((paragraph) => (
                      <div className="passage__paragraph" key={paragraph.label || paragraph.text.slice(0, 24)}>
                        <span className="passage__label">{paragraph.label}</span>
                        <span className="passage__text">{paragraph.text}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ) : previewQ.loading ? (
                <Loading label="Loading the paper…" />
              ) : activeSectionResult?.audio || activeSectionResult?.transcript || activePaperSection?.transcript ? (
                null
              ) : (
                <p className="muted small" style={{ padding: 12 }}>
                  {activePaperSection?.passage
                    ? 'Paper content unavailable — questions on the right still show answers and evidence.'
                    : 'No passage for this section.'}
                </p>
              )}
              {activeSectionResult?.audio ? (
                <div style={{ padding: '10px 12px 0' }}>
                  <audio ref={audioRef} controls preload="metadata" src={activeSectionResult.audio.url} style={{ width: '100%' }} />
                  <p className="tiny muted" style={{ margin: '6px 2px 0' }}>
                    <Icon name="headphones" size={12} /> Press “Listen from here” on any question to jump to its part.
                  </p>
                </div>
              ) : null}
              {activeSectionResult?.transcript ? (
                <TranscriptView transcript={activeSectionResult.transcript} highlightSegmentId={null} />
              ) : null}
              {activePaperSection?.transcript && !activeSectionResult?.transcript ? (
                <TranscriptView transcript={activePaperSection.transcript} highlightSegmentId={null} />
              ) : null}
            </div>
          }
          right={
            <div className="exam-pane__scroll">
              {activePaperSection ? (
                activePaperSection.groups.map((group) => {
                  const questions = group.questions.filter((question) => correctnessByQuestion.has(question.id));
                  if (questions.length === 0) return null;
                  return (
                    <div className="question-block" key={group.id}>
                      {group.instructions ? (
                        <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
                          {group.instructions}
                        </p>
                      ) : null}
                      {questions.map((question) => {
                        const item = correctnessByQuestion.get(question.id)!;
                        return (
                          <div key={question.id} id={`review-question-${question.number}`}>
                            <QuestionRenderer
                              group={group}
                              question={question}
                              response={item.candidateAnswer}
                              flagged={false}
                              active={false}
                              onAnswer={() => undefined}
                              onToggleFlag={() => undefined}
                              onFocusQuestion={() => undefined}
                              readOnly
                              correctness={{
                                isCorrect: item.isCorrect,
                                correctAnswer: item.correctAnswer,
                                candidateAnswer: item.candidateAnswer,
                              }}
                            />
                            <AnswerExplanation
                              number={item.number}
                              evidence={item.evidence}
                              explanation={item.explanation}
                              correctAnswer={item.correctAnswer}
                              transcriptSegmentId={evidenceSegmentId(item.evidence)}
                              onListenFrom={listenFrom}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                // Prompts-only fallback (the paper could not be loaded).
                <div className="question-block">
                  {reviewItems.map((item) => (
                    <div key={item.questionId} id={`review-question-${item.number}`}>
                      <QuestionRenderer
                        group={{
                          id: 'review',
                          type: 'SHORT_ANSWER',
                          instructions: '',
                          sharedOptions: [],
                          config: {},
                          rangeFrom: null,
                          rangeTo: null,
                          questions: [],
                        }}
                        question={{ id: item.questionId, number: item.number, prompt: item.prompt, options: [], config: {} }}
                        response={item.candidateAnswer}
                        flagged={false}
                        active={false}
                        onAnswer={() => undefined}
                        onToggleFlag={() => undefined}
                        onFocusQuestion={() => undefined}
                        readOnly
                        correctness={{
                          isCorrect: item.isCorrect,
                          correctAnswer: item.correctAnswer,
                          candidateAnswer: item.candidateAnswer,
                        }}
                      />
                      <AnswerExplanation
                        number={item.number}
                        evidence={item.evidence}
                        explanation={item.explanation}
                        correctAnswer={item.correctAnswer}
                        transcriptSegmentId={evidenceSegmentId(item.evidence)}
                        onListenFrom={listenFrom}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          }
        />
      )}

      {/* Bottom: jump strip, green/red per question */}
      {!isWriting && !speakingTab && reviewItems.length > 0 ? (
        <div className="exam-footer">
          <div className="nav-strip">
            {reviewItems.map((item) => (
              <button
                key={item.questionId}
                type="button"
                className={`nav-strip__item nav-strip__item--${item.isCorrect === null ? 'flagged' : item.isCorrect ? 'done' : 'missed'}`}
                title={item.isCorrect === null ? 'Not marked' : item.isCorrect ? 'Correct' : 'Incorrect'}
                onClick={() => {
                  document
                    .getElementById(`review-question-${item.number}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                {item.number}
              </button>
            ))}
          </div>
          <span className="tiny muted">
            <span className="nav-strip__item" style={{ display: 'inline-grid', width: 20, height: 20, marginRight: 4 }}>
              1
            </span>
            correct / red = wrong — click any number to jump to its explanation.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The exam's two panes with the same drag-the-divider control as the exam
 * itself: the width is shared with the exam (`exam.passageWidth` in storage)
 * and the divider also moves with the arrow keys.
 */
function SplitPanes({ share, left, right }: { share: number; left: ReactNode; right: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem('exam.passageWidth'));
    return Number.isFinite(stored) && stored >= 26 && stored <= 72 ? stored : share;
  });
  const setWidthStored = (value: number) => {
    const clamped = Math.min(72, Math.max(26, value));
    setWidth(clamped);
    try {
      window.localStorage.setItem('exam.passageWidth', String(Math.round(clamped * 10) / 10));
    } catch {
      /* private mode: the width still applies for this view */
    }
  };

  return (
    <div className="exam-body exam-body--split" ref={bodyRef} style={{ '--passage-share': `${width}%` } as React.CSSProperties}>
      <section className="exam-pane exam-pane--material">{left}</section>
      <div
        className="exam-divider"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={Math.round(width)}
        aria-label="Resize the two panes (arrow keys)"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setWidthStored(width + (event.key === 'ArrowRight' ? 3 : -3));
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const body = bodyRef.current;
          if (!body) return;
          const rect = body.getBoundingClientRect();
          if (rect.width === 0) return;
          setWidthStored(((event.clientX - rect.left) / rect.width) * 100);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      />
      <section className="exam-pane exam-pane--work">{right}</section>
    </div>
  );
}

function WritingReview({ session, sections }: { session: AttemptResultPayload['sessions'][number] | null; sections: CandidateSection[] }) {
  const [taskIdx, setTaskIdx] = useState(0);
  if (!session) return null;
  const submissions = session.writing ?? [];
  if (submissions.length === 0) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <p className="muted">No writing responses were submitted in this session.</p>
      </div>
    );
  }
  const idx = Math.min(taskIdx, submissions.length - 1);
  const submission = submissions[idx]!;
  // The prompt exactly as the exam showed it (rubric, requirements, chart).
  const paperTasks = writingTasksOf(sections);
  const ref: WritingTaskRef | null = paperTasks.find((item) => item.task.id === submission.questionId) ?? paperTasks[idx] ?? null;
  const ai = submission.ai ?? null;
  const teacher = submission.score && submission.score.source !== 'AI' ? submission.score : null;
  const bandText = (band: number | null) => (band === null || band === undefined ? '—' : formatBand(band));

  return (
    <SplitPanes
      share={42}
      left={
        <div className="exam-pane__scroll">
          {ref ? (
            <WritingPrompt item={ref} />
          ) : (
            <article className="passage-article">
              <div className="passage-article__head">
                <h2>{submission.taskLabel || 'Task'}</h2>
                <span className="tiny muted nowrap">{submission.wordCount} words</span>
              </div>
              {submission.prompt ? (
                <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{submission.prompt}</p>
              ) : null}
            </article>
          )}
        </div>
      }
      right={
        <div className="exam-pane__scroll">
          <div className="writing-answer">
            {submissions.length > 1 ? (
              <div className="writing-answer__tabs" role="tablist" aria-label="Writing tasks">
                {submissions.map((item, index) => (
                  <button
                    key={item.submissionId}
                    type="button"
                    role="tab"
                    aria-selected={index === idx}
                    className={`writing-answer__tab ${index === idx ? 'is-active' : ''}`}
                    onClick={() => setTaskIdx(index)}
                  >
                    {item.taskLabel || `Task ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : null}

            {/* The marks — first thing on screen */}
            <div className="review-scorebar">
              <span className="review-scorebar__band">{bandText(ai?.band ?? teacher?.band ?? null)}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {ai ? (
                  <span className="mchip mchip--violet">
                    <Icon name="sparkle" size={12} /> AI band {bandText(ai.band)}
                  </span>
                ) : (
                  <span className="mchip">Not marked by AI yet</span>
                )}
                {(ai?.criteria ?? []).map((criterion) => (
                  <span key={criterion.key} className="mchip" title={criterion.comment}>
                    {criterion.label} {bandText(criterion.band)}
                  </span>
                ))}
                {teacher ? (
                  <span className="mchip mchip--sun">
                    <Icon name="check" size={12} /> Teacher band {bandText(teacher.band)}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="writing-answer__meta">
              <span className="writing-answer__count">
                <strong>{submission.wordCount}</strong> words
              </span>
            </div>
            <div className="writing-answer__box writing-answer__box--review">
              {submission.responseText || <span className="muted">(no response)</span>}
            </div>
          </div>

          {/* Full AI judgement: criteria, feedback (EN + VI), strengths, next steps */}
          {ai ? <AiMarkPanel mark={ai} heading="AI marking" /> : null}
          {teacher ? (
            <div className="explain" style={{ marginTop: 10 }}>
              <div className="explain__head">
                <span className="explain__title">
                  <Icon name="info" size={15} />
                  Teacher feedback
                </span>
              </div>
              <div className="explain__body">
                <p className="explain__text">{teacher.feedback || 'No written feedback was added.'}</p>
              </div>
            </div>
          ) : null}
          {!ai && !teacher && submission.score?.feedback ? (
            <div className="explain" style={{ marginTop: 10 }}>
              <div className="explain__head">
                <span className="explain__title">
                  <Icon name="info" size={15} />
                  Examiner feedback
                </span>
              </div>
              <div className="explain__body">
                <p className="explain__text">{submission.score.feedback}</p>
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  );
}

/**
 * Speaking review inside the same exam chrome: the topic on the left, every
 * recorded answer with its transcript and AI judgement on the right.
 */
function SpeakingReview({ sessionId }: { sessionId: string }) {
  const detail = useAsync<{
    session: {
      topicTitle: string;
      status: string;
      overallBand: number | null;
      feedback: string;
      scoreSource: string | null;
    };
    topic: { title: string; part1: string[]; part2: { cue: string; bullets: string[] }; part3: string[] } | null;
    responses: Array<{ part: number; promptText: string; transcript: string; durationSeconds: number; words: number; hasAudio: boolean }>;
    score: {
      band: number | null;
      criteria: Array<{ key: string; label: string; band: number | null; comment: string }>;
      feedback: string;
      feedbackVi: string;
      strengths: string[];
      improvements: string[];
    } | null;
  }>(() => api.get(`/api/speaking/sessions/${encodeURIComponent(sessionId)}`), [sessionId]);

  if (detail.loading && !detail.data) return <Loading label="Loading speaking review…" />;
  if (detail.error && !detail.data) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <Notice tone="danger">{detail.error}</Notice>
      </div>
    );
  }
  if (!detail.data) return null;

  const { session, topic, responses, score } = detail.data;
  const partLabel = (part: number) => (part === 1 ? 'Part 1' : part === 2 ? 'Part 2 · Long turn' : 'Part 3');

  return (
    <SplitPanes
      share={42}
      left={
        <div className="exam-pane__scroll">
          <article className="passage-article">
            <div className="passage-article__head">
              <h2>{topic?.title ?? session.topicTitle}</h2>
              <span className="tiny muted nowrap">Speaking</span>
            </div>
            {topic ? (
              <div className="passage">
                <div className="passage__paragraph">
                  <span className="passage__label">1</span>
                  <span className="passage__text">{topic.part1.map((q) => `• ${q}`).join('\n')}</span>
                </div>
                <div className="passage__paragraph">
                  <span className="passage__label">2</span>
                  <span className="passage__text">
                    {topic.part2.cue}
                    {'\n\n'}
                    {topic.part2.bullets.map((b) => `• ${b}`).join('\n')}
                  </span>
                </div>
                <div className="passage__paragraph">
                  <span className="passage__label">3</span>
                  <span className="passage__text">{topic.part3.map((q) => `• ${q}`).join('\n')}</span>
                </div>
              </div>
            ) : (
              <p className="muted small" style={{ padding: 12 }}>Topic snapshot unavailable for this session.</p>
            )}
          </article>
        </div>
      }
      right={
        <div className="exam-pane__scroll">
          <div className="question-block">
            <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="mchip mchip--violet">
                {score?.band !== null && score?.band !== undefined
                  ? `AI band ${score.band}`
                  : session.overallBand !== null
                    ? `Band ${session.overallBand}`
                    : session.status === 'IN_PROGRESS'
                      ? 'Not recorded yet'
                      : 'Marking…'}
              </span>
              {score?.criteria?.map((criterion) => (
                <span key={criterion.key} className="mchip" title={criterion.comment}>
                  {criterion.label} {criterion.band !== null ? criterion.band : '—'}
                </span>
              ))}
            </div>

            {responses.length === 0 ? (
              <p className="muted small">
                {session.status === 'IN_PROGRESS'
                  ? 'The speaking task has not been recorded yet — open the Speaking tab to answer.'
                  : 'No recordings were saved for this session.'}
              </p>
            ) : null}

            {responses.map((response) => (
              <div key={response.part} id={`speaking-part-${response.part}`} className="question-block">
                <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
                  <b>{partLabel(response.part)}</b> · {response.promptText}
                </p>
                {response.hasAudio ? (
                  <audio
                    controls
                    preload="none"
                    src={`/api/speaking/sessions/${encodeURIComponent(sessionId)}/audio/${response.part}`}
                    style={{ width: '100%', marginBottom: 6 }}
                  />
                ) : null}
                <div
                  className="passage"
                  style={{ background: 'var(--ink-50)', borderRadius: 12, padding: '12px 14px', whiteSpace: 'pre-wrap' }}
                >
                  {response.transcript || <span className="muted">(no words recognised)</span>}
                </div>
                <p className="tiny muted" style={{ margin: '4px 2px 0' }}>
                  {response.words} words · {Math.round(response.durationSeconds)}s
                </p>
              </div>
            ))}

            {(score?.feedback || score?.feedbackVi || session.feedback) ? (
              <div className="explain">
                <div className="explain__head">
                  <span className="explain__title">
                    <Icon name="info" size={15} />
                    Speaking examiner feedback
                  </span>
                </div>
                <div className="explain__body">
                  <p className="explain__text">{score?.feedback || session.feedback}</p>
                  {score?.feedbackVi ? <p className="explain__text">{score.feedbackVi}</p> : null}
                  {score?.strengths?.length ? (
                    <p className="explain__text">
                      <b>Strengths:</b> {score.strengths.join(' · ')}
                    </p>
                  ) : null}
                  {score?.improvements?.length ? (
                    <p className="explain__text">
                      <b>Improve:</b> {score.improvements.join(' · ')}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      }
    />
  );
}

export default AttemptReviewPage;
