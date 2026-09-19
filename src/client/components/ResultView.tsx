import { useMemo, useRef, useState } from 'react';
import type { CandidateResponse } from '@shared/answer-key';
import { api, describeError } from '../lib/api';
import { Badge, Button, Card, Field, KeyValue, Notice, Stat, Tabs, TextArea, TextInput, useToast } from './ui';
import { QuestionRenderer } from './exam/QuestionRenderer';
import { TranscriptView } from './exam/TranscriptView';
import { AnswerExplanation, evidenceSegmentId } from './exam/AnswerExplanation';
import { BAND_DISCLAIMER, formatBand, formatDateTime, formatDuration, formatPercent, formatScore, MODE_LABELS, SKILL_LABELS, TEST_TYPE_LABELS } from '../lib/format';
import { AccuracyList } from './charts';

export interface AttemptResultPayload {
  attemptId: string;
  testId: string;
  testTitle: string;
  testType: string;
  testVersionId: string;
  versionNumber: number;
  mode: string;
  status: string;
  startedAt: string;
  submittedAt: string | null;
  durationSeconds: number | null;
  resultVisibility: string;
  release: { reviewAvailable: boolean; scoreAvailable: boolean; reason: string; releasesAt: string | null };
  rawScore: number | null;
  totalQuestions: number | null;
  estimatedBand: number | null;
  bandNote: string | null;
  sessions: Array<{
    skillSessionId: string;
    componentIndex: number;
    skill: string;
    label: string;
    startedAt: string | null;
    submittedAt: string | null;
    status: string;
    rawScore: number;
    totalQuestions: number;
    band: number | null;
    bandAvailable: boolean;
    bandMessage: string;
    profileId: string | null;
    profileVersion: number | null;
    /** 36: per-section (passage/part/task) diagnostic breakdown. */
    sectionResults: Array<{
      sectionId: string;
      orderIndex: number;
      skill: string;
      type: string;
      label: string;
      title: string;
      totalQuestions: number;
      answeredCount: number;
      flaggedCount: number;
      rawScore: number | null;
      correctCount: number | null;
      passage: { id: string; title: string; subtitle: string | null; paragraphs: Array<{ label: string; text: string }>; wordCount: number } | null;
      audio: { assetId: string; url: string; durationSeconds: number | null } | null;
      image: { assetId: string; url: string } | null;
      transcript: { segments: Array<{ id: string; startSeconds: number | null; speaker: string | null; text: string }> } | null;
    }>;
    review: Array<{
      questionId: string;
      number: number;
      prompt: string;
      candidateAnswer: CandidateResponse | null;
      correctAnswer: string | null;
      isCorrect: boolean | null;
      points: number | null;
      pointsPossible: number;
      questionType: string;
      evidence: string | null;
      explanation: string | null;
      sectionId: string | null;
      sectionLabel: string | null;
      sectionOrder: number | null;
    }> | null;
    writing: Array<{
      submissionId: string;
      questionId: string;
      taskLabel: string;
      responseText: string;
      wordCount: number;
      prompt: string;
      score: { band: number | null; feedback: string; source: string; scoredAt: string; criteria?: Record<string, number> } | null;
    }>;
  }>;
  integrity: {
    counted: number;
    tabAway: number;
    fullscreenExits: number;
    copies: number;
    pastes: number;
    interruptions: number;
    total: number;
    events: Array<{ type: string; occurredAt: string; severity: string }>;
    statement: string;
  };
  student?: { id: string; email?: string; displayName?: string | null };
}

export function ResultSummary({
  result,
  marking,
}: {
  result: AttemptResultPayload;
  marking?: { apiBase: '/api/admin' | '/api/teacher'; onSaved: () => Promise<void> };
}) {
  const accuracy = formatPercent(
    result.rawScore !== null && result.totalQuestions
      ? Math.round((result.rawScore / result.totalQuestions) * 1000) / 10
      : null,
  );

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label="Raw score" value={formatScore(result.rawScore, result.totalQuestions)} hint={accuracy !== '—' ? `${accuracy} accuracy` : undefined} />
        <Stat
          label="Estimated band"
          value={formatBand(result.estimatedBand)}
          hint={result.estimatedBand === null ? 'No applicable scoring profile' : 'Practice indication only'}
        />
        <Stat label="Duration" value={formatDuration(result.durationSeconds)} hint={`Submitted ${formatDateTime(result.submittedAt)}`} />
        <Stat label="Test version" value={`v${result.versionNumber}`} hint={MODE_LABELS[result.mode] ?? result.mode} />
      </div>

      {result.estimatedBand !== null ? <Notice tone="info">{BAND_DISCLAIMER}</Notice> : null}
      {!result.release.reviewAvailable ? <Notice tone="warning">{result.release.reason}</Notice> : null}

      {result.sessions.map((session) => (
        <Card
          key={session.skillSessionId}
          title={`${SKILL_LABELS[session.skill] ?? session.skill} · ${session.label}`}
          hint={`${session.status} · started ${formatDateTime(session.startedAt)}`}
          actions={
            session.skill === 'WRITING' ? null : (
              <>
                <Badge tone="neutral">
                  {formatScore(session.rawScore, session.totalQuestions)}
                </Badge>
                {session.band !== null ? <Badge tone="accent">Estimated {formatBand(session.band)}</Badge> : null}
              </>
            )
          }
        >
          {session.skill !== 'WRITING' && session.band === null ? (
            <p className="small muted">{session.bandMessage}</p>
          ) : null}

          {session.skill === 'WRITING' ? (
            <div className="stack">
              {session.writing.length === 0 ? <p className="muted small">No writing response was submitted.</p> : null}
              {session.writing.map((writing) => (
                <div key={writing.questionId} className="card" style={{ background: 'var(--paper-muted)' }}>
                  <div className="row row--between">
                    <strong>{writing.taskLabel || 'Writing task'}</strong>
                    <span className="tiny muted">{writing.wordCount} words</span>
                  </div>
                  {writing.prompt ? <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{writing.prompt}</p> : null}
                  {writing.responseText ? (
                    <details>
                      <summary className="small">View submitted response</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-ui)', fontSize: '0.94rem', marginTop: 10 }}>
                        {writing.responseText}
                      </pre>
                    </details>
                  ) : null}
                  {writing.score ? (
                    <Notice tone="success" title={`Score: band ${formatBand(writing.score.band)} (${writing.score.source.toLowerCase()})`}>
                      {writing.score.feedback || 'No written feedback was added.'}
                    </Notice>
                  ) : (
                    <p className="tiny muted">Awaiting marking by a teacher or administrator. Writing is never scored automatically.</p>
                  )}
                  {marking ? (
                    <WritingMarkForm
                      apiBase={marking.apiBase}
                      submissionId={writing.submissionId}
                      existing={writing.score}
                      onSaved={marking.onSaved}
                      taskLabel={writing.taskLabel}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {session.sectionResults.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <h4 style={{ margin: '0 0 6px' }} className="small">
                By {session.skill === 'LISTENING' ? 'part' : session.skill === 'READING' ? 'passage' : 'task'}
              </h4>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th className="num">Score</th>
                      <th className="num">Correct</th>
                      <th className="num">Answered</th>
                      <th className="num">Flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.sectionResults.map((section) => (
                      <tr key={section.sectionId}>
                        <td>
                          {section.label}
                          {section.title && section.title !== section.label ? (
                            <span className="tiny muted"> · {section.title}</span>
                          ) : null}
                        </td>
                        <td className="num">
                          {section.rawScore !== null && section.totalQuestions > 0
                            ? `${section.rawScore}/${section.totalQuestions}`
                            : '—'}
                        </td>
                        <td className="num">{section.correctCount ?? '—'}</td>
                        <td className="num">
                          {section.answeredCount}/{section.totalQuestions}
                        </td>
                        <td className="num">{section.flaggedCount || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted" style={{ marginTop: 6 }}>
                Section scores are diagnostic only — they are not converted into separate IELTS bands.
              </p>
            </div>
          ) : null}

          {session.review && session.review.length > 0 ? (
            <SectionReview
              attemptId={result.attemptId}
              sections={session.sectionResults}
              review={session.review}
              marking={marking}
            />
          ) : null}
        </Card>
      ))}

      <Card title="Integrity summary" hint="Observable browser events recorded during this attempt">
        <KeyValue
          items={[
            ['Counted events', `${result.integrity.counted} (tab hidden: ${result.integrity.tabAway}, fullscreen exits: ${result.integrity.fullscreenExits})`],
            ['Copy / paste attempts', `${result.integrity.copies} / ${result.integrity.pastes}`],
            ['Connection interruptions', String(result.integrity.interruptions)],
            ['Total events logged', String(result.integrity.total)],
          ]}
        />
        <p className="tiny muted" style={{ marginTop: 10 }}>
          {result.integrity.statement}
        </p>
        {result.integrity.events.length > 0 ? (
          <details style={{ marginTop: 8 }}>
            <summary className="small">Event log</summary>
            <ul className="small" style={{ marginTop: 8 }}>
              {result.integrity.events.map((event, index) => (
                <li key={`${event.type}-${index}`}>
                  <span className="mono">{event.type}</span> · {formatDateTime(event.occurredAt)} · {event.severity}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </div>
  );
}

function QuestionMarkControls({
  apiBase,
  attemptId,
  questionId,
  current,
  onSaved,
}: {
  apiBase: '/api/admin' | '/api/teacher';
  attemptId: string;
  questionId: string;
  current: boolean | null;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mark = async (isCorrect: boolean | null) => {
    setBusy(true);
    try {
      await api.post(`${apiBase}/attempts/${attemptId}/question-marks`, { questionId, isCorrect });
      await onSaved();
      toast.push(isCorrect === null ? 'Mark cleared.' : isCorrect ? 'Marked correct.' : 'Marked incorrect.', 'success');
    } catch (markError) {
      toast.push(describeError(markError), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
      <Button size="sm" variant={current === true ? 'success' : 'default'} disabled={busy} onClick={() => void mark(true)}>
        Correct
      </Button>
      <Button size="sm" variant={current === false ? 'danger' : 'default'} disabled={busy} onClick={() => void mark(false)}>
        Incorrect
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mark(null)}>
        Clear
      </Button>
    </div>
  );
}

const WRITING_CRITERIA: Array<{ key: string; label: string; task?: '1' | '2' }> = [
  { key: 'TA', label: 'Task Achievement', task: '1' },
  { key: 'TR', label: 'Task Response', task: '2' },
  { key: 'CC', label: 'Coherence & cohesion' },
  { key: 'LR', label: 'Lexical resource' },
  { key: 'GRA', label: 'Grammatical range & accuracy' },
];

function criteriaForTask(taskLabel: string | undefined): typeof WRITING_CRITERIA {
  const isTask1 = /task\s*1/i.test(taskLabel ?? '');
  const isTask2 = /task\s*2/i.test(taskLabel ?? '');
  return WRITING_CRITERIA.filter((item) => {
    if (!item.task) return true;
    if (isTask1) return item.task === '1';
    if (isTask2) return item.task === '2';
    return true;
  });
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function WritingMarkForm({
  apiBase,
  submissionId,
  existing,
  onSaved,
  taskLabel,
  wordCount,
  prompt,
  responseText,
}: {
  apiBase: '/api/admin' | '/api/teacher';
  submissionId: string;
  existing: { band: number | null; feedback: string; source: string; scoredAt: string; criteria?: Record<string, number> } | null;
  onSaved: () => Promise<void>;
  taskLabel?: string;
  wordCount?: number;
  prompt?: string;
  responseText?: string;
}) {
  const toast = useToast();
  const visibleCriteria = criteriaForTask(taskLabel);
  const [band, setBand] = useState(existing?.band != null ? String(existing.band) : '');
  const [feedback, setFeedback] = useState(existing?.feedback ?? '');
  const [criteria, setCriteria] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of visibleCriteria) {
      const value = existing?.criteria?.[item.key];
      initial[item.key] = value != null ? String(value) : '';
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);

  const applyCriteriaAverage = (next: Record<string, string>) => {
    const numbers = visibleCriteria
      .map((item) => Number(next[item.key]))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 9);
    if (numbers.length === visibleCriteria.length && numbers.length > 0) {
      setBand(String(roundHalf(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)));
    }
  };

  return (
    <div className="stack" style={{ marginTop: 10 }}>
      {prompt ? <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{prompt}</p> : null}
      {responseText ? (
        <details open>
          <summary className="small">
            Candidate response{wordCount != null ? ` · ${wordCount} words` : ''}
          </summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-ui)', fontSize: '0.94rem', marginTop: 10 }}>
            {responseText}
          </pre>
        </details>
      ) : null}
      <div className="grid grid--2">
        {visibleCriteria.map((item) => (
          <Field key={item.key} label={item.label} hint="Half bands, 0–9">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                max={9}
                step={0.5}
                value={criteria[item.key] ?? ''}
                onChange={(event) => {
                  const next = { ...criteria, [item.key]: event.target.value };
                  setCriteria(next);
                  applyCriteriaAverage(next);
                }}
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="Overall band" hint="Filled from the criteria when all are set. Half bands allowed. Leave empty to clear.">
        {(id) => (
          <TextInput
            id={id}
            type="number"
            min={0}
            max={9}
            step={0.5}
            value={band}
            onChange={(event) => setBand(event.target.value)}
          />
        )}
      </Field>
      <Field label="Feedback to the student">
        {(id) => <TextArea id={id} rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} />}
      </Field>
      <Button
        variant="primary"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const parsedCriteria: Record<string, number> = {};
            for (const [key, value] of Object.entries(criteria)) {
              if (value === '') continue;
              const number = Number(value);
              if (Number.isFinite(number)) parsedCriteria[key] = number;
            }
            await api.post(`${apiBase}/writing-scores`, {
              writingSubmissionId: submissionId,
              band: band === '' ? null : Number(band),
              feedback,
              criteria: parsedCriteria,
            });
            await onSaved();
            toast.push('Writing score saved. The student sees this as a practice band, not an official result.', 'success');
          } catch (scoreError) {
            toast.push(describeError(scoreError), 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        Save writing score
      </Button>
    </div>
  );
}

function renderAnswer(answer: { value?: string; values?: string[] } | null): string {
  if (!answer) return '—';
  if (answer.values) return answer.values.length > 0 ? answer.values.join(', ') : '—';
  return answer.value && answer.value.trim() ? answer.value : '—';
}

type SectionResultRow = AttemptResultPayload['sessions'][number]['sectionResults'][number];
type ReviewRow = NonNullable<AttemptResultPayload['sessions'][number]['review']>[number];

/**
 * 37. Section-aware review: questions are grouped under Passage/Part/Task
 * tabs, and each part loads its own passage, transcript and audio alongside
 * the per-question evidence and outcomes.
 */
function SectionReview({
  attemptId,
  sections,
  review,
  marking,
}: {
  attemptId: string;
  sections: SectionResultRow[];
  review: ReviewRow[];
  marking?: { apiBase: '/api/admin' | '/api/teacher'; onSaved: () => Promise<void> };
}) {
  const reviewSections = useMemo(() => {
    const ids: Array<{ id: string; label: string; order: number }> = [];
    const seen = new Set<string>();
    for (const item of review) {
      const key = item.sectionId ?? 'none';
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push({ id: key, label: item.sectionLabel ?? 'Questions', order: item.sectionOrder ?? 0 });
    }
    for (const section of sections) {
      if (!seen.has(section.sectionId)) {
        seen.add(section.sectionId);
        ids.push({ id: section.sectionId, label: section.label, order: section.orderIndex });
      }
    }
    return ids.sort((a, b) => a.order - b.order);
  }, [review, sections]);

  const [activeId, setActiveId] = useState<string>(reviewSections[0]?.id ?? 'none');
  const [highlightSegment, setHighlightSegment] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeId_ = reviewSections.some((section) => section.id === activeId) ? activeId : reviewSections[0]?.id ?? 'none';
  const activeItems = review.filter((item) => (item.sectionId ?? 'none') === activeId_);
  const activeSection = sections.find((section) => section.sectionId === activeId_) ?? null;
  const explainable = activeItems.filter((item) => item.evidence || item.explanation);

  const correct = review.filter((item) => item.isCorrect).length;
  const incorrect = review.filter((item) => item.isCorrect === false).length;
  const unanswered = review.filter((item) => item.isCorrect !== null && item.candidateAnswer === null).length;

  return (
    <details style={{ marginTop: 10 }}>
      <summary className="small" style={{ cursor: 'pointer' }}>
        Question-by-question review ({review.length} questions)
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <AccuracyList
          items={[
            { label: 'Correct', correct, total: review.length, accuracy: review.length > 0 ? Math.round((correct / review.length) * 1000) / 10 : null },
            { label: 'Incorrect', correct: incorrect, total: review.length, accuracy: null },
            { label: 'Unanswered', correct: unanswered, total: review.length, accuracy: null },
          ]}
        />

        {reviewSections.length > 1 ? (
          <Tabs
            tabs={reviewSections.map((section) => ({ id: section.id, label: section.label }))}
            value={activeId_}
            onChange={setActiveId}
          />
        ) : null}

        {activeSection?.audio ? (
          <audio
            ref={audioRef}
            controls
            preload="none"
            src={activeSection.audio.url}
            style={{ width: '100%' }}
          />
        ) : null}

        {activeSection?.passage ? (
          <details className="card" style={{ background: 'var(--paper-muted)' }}>
            <summary className="small">
              {activeSection.passage.title || 'Passage'} ({activeSection.passage.wordCount} words)
            </summary>
            <div className="passage" style={{ marginTop: 10 }}>
              {activeSection.passage.paragraphs.map((paragraph, index) => (
                <div className="passage__paragraph" key={index}>
                  <span className="passage__label">{paragraph.label}</span>
                  <span className="passage__text">{paragraph.text}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {activeSection?.transcript && activeSection.transcript.segments.length > 0 ? (
          <details className="card" open>
            <summary className="small">Transcript ({activeSection.transcript.segments.length} segments)</summary>
            <div style={{ marginTop: 12 }}>
              <TranscriptView transcript={activeSection.transcript} highlightSegmentId={highlightSegment} />
            </div>
          </details>
        ) : null}

        {explainable.length > 0 ? (
          <Card title="Why these answers" hint="Evidence and explanations released with this result">
            <div className="stack">
              {explainable.map((item) => (
                <div key={item.questionId} className="review-q" id={`review-q-${item.number}`}>
                  <div className="review-q__head">
                    <span className="review-q__number">{item.number}</span>
                    <span className="review-q__prompt">{item.prompt}</span>
                    <Badge
                      tone={item.isCorrect === null ? 'neutral' : item.isCorrect ? 'success' : 'danger'}
                    >
                      {item.isCorrect === null ? 'Not marked' : item.isCorrect ? 'Correct' : 'Incorrect'}
                    </Badge>
                  </div>
                  <div className="review-q__answers">
                    <span className="review-q__answer">
                      Your answer: <strong>{renderAnswer(item.candidateAnswer)}</strong>
                    </span>
                    {item.correctAnswer ? (
                      <span className="review-q__answer review-q__answer--key">
                        Accepted: <strong>{item.correctAnswer}</strong>
                      </span>
                    ) : null}
                  </div>
                  <AnswerExplanation
                    number={item.number}
                    evidence={item.evidence}
                    explanation={item.explanation}
                    correctAnswer={item.correctAnswer}
                    transcriptSegmentId={evidenceSegmentId(item.evidence)}
                    onListenFrom={
                      activeSection?.audio
                        ? (segmentId) => {
                            const segment = activeSection.transcript?.segments.find((row) => row.id === segmentId);
                            setHighlightSegment(segmentId);
                            if (!segment || segment.startSeconds === null) return;
                            const audio = audioRef.current;
                            if (!audio) return;
                            audio.currentTime = segment.startSeconds;
                            void audio.play();
                          }
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Question</th>
                <th>Your answer</th>
                <th>Accepted answer</th>
                <th />
                {marking ? <th>Mark</th> : null}
              </tr>
            </thead>
            <tbody>
              {activeItems.map((item) => {
                const unansweredItem = item.candidateAnswer === null || renderAnswer(item.candidateAnswer) === '—';
                return (
                  <tr key={item.questionId}>
                    <td className="num">{item.number}</td>
                    <td style={{ maxWidth: 360 }}>
                      {item.prompt}
                      {item.evidence ? (
                        <div className="tiny muted" style={{ marginTop: 4 }}>
                          Evidence: {item.evidence}
                        </div>
                      ) : null}
                      {item.explanation ? (
                        <div className="tiny muted" style={{ marginTop: 2 }}>
                          {item.explanation}
                        </div>
                      ) : null}
                    </td>
                    <td>{renderAnswer(item.candidateAnswer)}</td>
                    <td>{item.correctAnswer ?? '—'}</td>
                    <td>
                      <Badge tone={item.isCorrect === null ? 'neutral' : unansweredItem && item.isCorrect === false ? 'warning' : item.isCorrect ? 'success' : 'danger'}>
                        {item.isCorrect === null ? 'Not marked' : unansweredItem ? 'Unanswered' : item.isCorrect ? 'Correct' : 'Incorrect'}
                      </Badge>
                    </td>
                    {marking ? (
                      <td>
                        <QuestionMarkControls
                          apiBase={marking.apiBase}
                          attemptId={attemptId}
                          questionId={item.questionId}
                          current={item.isCorrect}
                          onSaved={marking.onSaved}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/** Read-only question rendering used by teachers and admins when reviewing. */
export function ReviewQuestions({
  items,
  testType,
}: {
  items: AttemptResultPayload['sessions'][number]['review'];
  testType: string;
}) {
  if (!items || items.length === 0) return <p className="muted small">No question-level data for this section.</p>;
  const group = {
    id: 'review',
    type: 'SHORT_ANSWER' as const,
    instructions: '',
    sharedOptions: [],
    config: {},
    rangeFrom: null,
    rangeTo: null,
    questions: [],
  };
  return (
    <div className="stack">
      {items.map((item) => (
        <QuestionRenderer
          key={item.questionId}
          group={{ ...group, type: 'SHORT_ANSWER' }}
          question={{
            id: item.questionId,
            number: item.number,
            prompt: item.prompt,
            options: [],
            config: {},
          }}
          response={item.candidateAnswer}
          flagged={false}
          active={false}
          onAnswer={() => undefined}
          onToggleFlag={() => undefined}
          onFocusQuestion={() => undefined}
          readOnly
          correctness={{ isCorrect: item.isCorrect, correctAnswer: item.correctAnswer, candidateAnswer: item.candidateAnswer }}
        />
      ))}
      <p className="tiny muted">{TEST_TYPE_LABELS[testType] ?? testType}</p>
    </div>
  );
}
