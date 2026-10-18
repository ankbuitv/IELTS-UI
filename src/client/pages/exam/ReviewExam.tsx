import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { useAsync } from '../../hooks/useAsync';
import { Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { QuestionRenderer } from '../../components/exam/QuestionRenderer';
import { AnswerExplanation, evidenceSegmentId } from '../../components/exam/AnswerExplanation';
import { TranscriptView } from '../../components/exam/TranscriptView';
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
    <div className="exam-root">
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

      {sessions.length > 1 ? (
        <div className="exam-seg" role="tablist" style={{ margin: '10px 16px 0' }}>
          {sessions.map((session, index) => (
            <button
              key={session.skillSessionId}
              type="button"
              role="tab"
              aria-selected={index === sessionIdx}
              className={`exam-seg__btn ${index === sessionIdx ? 'is-on' : ''}`}
              onClick={() => {
                setSessionIdx(index);
                setSectionId(null);
              }}
            >
              {session.label || session.skill}
            </button>
          ))}
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

      {isWriting ? (
        <WritingReview session={activeSession} />
      ) : (
        <div className="exam-body exam-body--split" style={{ '--passage-share': '46%' } as React.CSSProperties}>
          {/* Left: the material, exactly as it was in the exam */}
          <div className="exam-pane">
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
              ) : (
                <p className="muted small" style={{ padding: 12 }}>
                  {activePaperSection?.passage
                    ? 'Paper content unavailable — questions on the right still show answers and evidence.'
                    : 'No passage for this section.'}
                </p>
              )}
              {activeSectionResult?.transcript ? (
                <TranscriptView transcript={activeSectionResult.transcript} highlightSegmentId={null} />
              ) : null}
              {activePaperSection?.transcript && !activeSectionResult?.transcript ? (
                <TranscriptView transcript={activePaperSection.transcript} highlightSegmentId={null} />
              ) : null}
            </div>
          </div>

          {/* Right: read-only questions with answers + evidence */}
          <div className="exam-pane">
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
                              onListenFrom={(segmentId) => {
                                document
                                  .getElementById(`transcript-segment-${segmentId}`)
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              }}
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
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom: jump strip, green/red per question */}
      {!isWriting && reviewItems.length > 0 ? (
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

function WritingReview({ session }: { session: AttemptResultPayload['sessions'][number] | null }) {
  if (!session) return null;
  const tasks = session.writing ?? [];
  if (tasks.length === 0) {
    return (
      <div className="stack" style={{ padding: 24 }}>
        <p className="muted">No writing responses were submitted in this session.</p>
      </div>
    );
  }
  return (
    <div className="stack" style={{ padding: '18px 20px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
      {tasks.map((task) => (
        <article className="card" key={task.submissionId}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong>{task.taskLabel}</strong>
            <span className="row" style={{ gap: 8 }}>
              <span className="mchip">{task.wordCount} words</span>
              {task.ai?.band !== null && task.ai?.band !== undefined ? (
                <span className="mchip mchip--violet">AI band {task.ai.band}</span>
              ) : task.score?.band !== null && task.score?.band !== undefined ? (
                <span className="mchip mchip--violet">Band {task.score.band}</span>
              ) : (
                <span className="mchip">Not marked</span>
              )}
            </span>
          </div>
          <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
            {task.prompt}
          </p>
          <div
            className="passage"
            style={{ background: 'var(--ink-50)', borderRadius: 12, padding: '14px 16px', whiteSpace: 'pre-wrap' }}
          >
            {task.responseText || <span className="muted">(no response)</span>}
          </div>
          {(task.ai?.feedback || task.score?.feedback) ? (
            <div className="explain">
              <div className="explain__head">
                <span className="explain__title">
                  <Icon name="info" size={15} />
                  Examiner feedback
                </span>
              </div>
              <div className="explain__body">
                <p className="explain__text">{task.ai?.feedback ?? task.score?.feedback}</p>
                {task.ai?.criteria?.length ? (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {task.ai.criteria.map((criterion) => (
                      <span className="mchip" key={criterion.key} title={criterion.comment}>
                        {criterion.label}: {criterion.band ?? '—'}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export default AttemptReviewPage;
