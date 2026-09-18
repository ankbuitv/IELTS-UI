import type { CandidateResponse } from '@shared/answer-key';
import { Badge, Card, KeyValue, Notice, Stat } from './ui';
import { QuestionRenderer } from './exam/QuestionRenderer';
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
    }> | null;
    writing: Array<{
      submissionId: string;
      questionId: string;
      taskLabel: string;
      responseText: string;
      wordCount: number;
      prompt: string;
      score: { band: number | null; feedback: string; source: string; scoredAt: string } | null;
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

export function ResultSummary({ result }: { result: AttemptResultPayload }) {
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
                </div>
              ))}
            </div>
          ) : null}

          {session.review && session.review.length > 0 ? (
            <details style={{ marginTop: 10 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>
                Question-by-question review ({session.review.length} questions)
              </summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <AccuracyList
                  items={[
                    {
                      label: 'Correct',
                      correct: session.review.filter((item) => item.isCorrect).length,
                      total: session.review.length,
                      accuracy:
                        session.review.length > 0
                          ? Math.round(
                              (session.review.filter((item) => item.isCorrect).length / session.review.length) * 1000,
                            ) / 10
                          : null,
                    },
                  ]}
                />
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>Question</th>
                        <th>Your answer</th>
                        <th>Accepted answer</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {session.review.map((item) => (
                        <tr key={item.questionId}>
                          <td className="num">{item.number}</td>
                          <td style={{ maxWidth: 360 }}>{item.prompt}</td>
                          <td>{renderAnswer(item.candidateAnswer)}</td>
                          <td>{item.correctAnswer ?? '—'}</td>
                          <td>
                            <Badge tone={item.isCorrect ? 'success' : 'danger'}>
                              {item.isCorrect === null ? 'Not marked' : item.isCorrect ? 'Correct' : 'Incorrect'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
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

function renderAnswer(answer: { value?: string; values?: string[] } | null): string {
  if (!answer) return '—';
  if (answer.values) return answer.values.length > 0 ? answer.values.join(', ') : '—';
  return answer.value && answer.value.trim() ? answer.value : '—';
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
