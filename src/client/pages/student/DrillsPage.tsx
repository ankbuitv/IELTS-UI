import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../../lib/api';
import { Badge, Button, Card, Loading, Notice } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { QuestionRenderer } from '../../components/exam/QuestionRenderer';
import { ReviewAudioPlayer } from '../../components/exam/ReviewAudioPlayer';
import type { CandidateQuestion, CandidateQuestionGroup } from '@shared/question-types';
import type { CandidateResponse } from '@shared/answer-key';
import {
  countAnsweredDrillQuestions,
  toDrillSubmission,
  type DrillGroup,
  type DrillResult,
  type DrillSession,
  type DrillTypeInfo,
} from '@shared/drills';

/**
 * #6 Question-type drills: pick one format, answer up to eight questions with
 * the passage or transcript in view, and get the key with explanations. No
 * attempt is created, so a drill never pollutes the band history.
 */
export function DrillsPage() {
  const [types, setTypes] = useState<DrillTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [session, setSession] = useState<DrillSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, CandidateResponse>>({});
  const [result, setResult] = useState<DrillResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .get<{ types: DrillTypeInfo[] }>('/api/student/drills/types')
      .then((data) => {
        if (alive) setTypes(data.types);
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
  }, []);

  const totalQuestions = useMemo(
    () => session?.groups.reduce((total, group) => total + group.questions.length, 0) ?? 0,
    [session],
  );
  const answered = countAnsweredDrillQuestions(answers);

  const start = async (type: DrillTypeInfo) => {
    setStarting(type.type);
    setError(null);
    try {
      const created = await api.post<DrillSession>('/api/student/drills', { questionType: type.type });
      setSession(created);
      setAnswers({});
      setResult(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setStarting(null);
    }
  };

  const submit = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      setResult(
        await api.post<DrillResult>(`/api/student/drills/${encodeURIComponent(session.id)}/submit`, {
          answers: toDrillSubmission(answers),
        }),
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading label="Loading drills…" />;

  if (result) {
    const percent = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0;
    return (
      <div className="stack drill-page">
        <div className="drill-result__head">
          <div>
            <p className="tiny muted" style={{ margin: 0 }}>
              Question-type drill
            </p>
            <h1 style={{ margin: '2px 0 4px' }}>{types.find((item) => item.type === result.type)?.label ?? 'Drill result'}</h1>
            <p className="muted small" style={{ margin: 0 }}>
              {result.correct} of {result.total} correct ({percent}%)
            </p>
          </div>
          <div className="row">
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setSession(null);
                setAnswers({});
              }}
            >
              Choose another type
            </Button>
            {session ? (
              <Button
                variant="primary"
                onClick={() => {
                  const type = types.find((item) => item.type === result.type);
                  if (type) void start(type);
                }}
              >
                <Icon name="rotate" size={15} /> Try again
              </Button>
            ) : null}
          </div>
        </div>

        {session?.groups.map((group) => {
          const groupQuestions = result.questions.filter((question) =>
            group.questions.some((item) => item.id === question.questionId),
          );
          const paper = paperGroup(group);
          return (
            <Card key={group.id} title={`${group.type.replace(/_/g, ' ').toLowerCase()} · ${groupQuestions.length} question(s)`}>
              {groupQuestions.map((question) => {
                const item = group.questions.find((entry) => entry.id === question.questionId);
                if (!item) return null;
                return (
                  <div key={question.questionId} className="drill-result__question">
                    <QuestionRenderer
                      group={paper}
                      question={paperQuestion(item)}
                      response={null}
                      flagged={false}
                      active={false}
                      onAnswer={() => undefined}
                      onToggleFlag={() => undefined}
                      onFocusQuestion={() => undefined}
                      readOnly
                      correctness={{
                        isCorrect: question.correct,
                        correctAnswer: question.correctAnswer,
                        candidateAnswer: question.candidateAnswer ? { value: question.candidateAnswer } : null,
                      }}
                    />
                    {question.explanation || question.evidence ? (
                      <div className="explain">
                        <div className="explain__body">
                          {question.explanation ? (
                            <p className="explain__text">
                              <span className="explain__label">Why</span>
                              {question.explanation}
                            </p>
                          ) : null}
                          {question.evidence ? (
                            <p className="explain__text explain__text--evidence">
                              <span className="explain__label">Evidence</span>
                              {question.evidence}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          );
        })}
        <p className="tiny muted">
          A drill does not count towards your estimated band. Ready for a scored set? <Link to="/practice">Open practice</Link>.
        </p>
      </div>
    );
  }

  if (session) {
    return (
      <div className="stack drill-page">
        <div className="drill-head">
          <div>
            <p className="tiny muted" style={{ margin: 0 }}>
              Question-type drill
            </p>
            <h1 style={{ margin: '2px 0 4px' }}>{types.find((item) => item.type === session.type)?.label ?? session.type}</h1>
            <p className="muted small" style={{ margin: 0 }}>
              {answered} of {totalQuestions} answered · answers are marked when you submit
            </p>
          </div>
          <div className="row">
            <Button variant="secondary" onClick={() => setSession(null)}>
              Leave drill
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>
              Check answers
            </Button>
          </div>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {session.groups.map((group) => (
          <div key={group.id} className="drill-group">
            {group.contextText ? (
              <Card title={group.contextTitle || 'Context'}>
                {group.audioUrl ? (
                  <ReviewAudioPlayer src={group.audioUrl} title={group.contextTitle || 'Nghe ngữ cảnh'} />
                ) : null}
                <div className="drill-context">{group.contextText}</div>
              </Card>
            ) : null}
            <Card title={group.instructions || group.type.replace(/_/g, ' ').toLowerCase()}>
              <div className="drill-questions">
                {group.questions.map((question) => (
                  <QuestionRenderer
                    key={question.id}
                    group={paperGroup(group)}
                    question={paperQuestion(question)}
                    response={answers[question.id] ?? null}
                    flagged={false}
                    active={false}
                    onAnswer={(questionId, response) =>
                      setAnswers((current) => {
                        const next = { ...current };
                        if (response) next[questionId] = response;
                        else delete next[questionId];
                        return next;
                      })
                    }
                    onToggleFlag={() => undefined}
                    onFocusQuestion={() => undefined}
                  />
                ))}
              </div>
            </Card>
          </div>
        ))}

        <div className="drill-footer">
          <span className="tiny muted">
            {answered}/{totalQuestions} answered
          </span>
          <Button variant="primary" loading={submitting} disabled={answered === 0} onClick={() => void submit()}>
            Check answers
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack drill-page">
      <div className="page-head">
        <div>
          <h1>Question-type drills</h1>
          <p className="page-head__meta">
            One format at a time; a short set from the published papers, marked against the real answer key. Drills never
            affect your band history.
          </p>
        </div>
        <div className="row">
          <Badge tone="accent">4–8 questions · no timer</Badge>
          <span className="tiny muted">5 drills a day</span>
        </div>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {types.length === 0 ? (
        <Notice tone="info" title="No drills available yet">
          Drills appear once a published paper has at least three questions of the same type with an answer key.
        </Notice>
      ) : (
        <div className="drill-types">
          {types.map((type) => (
            <article key={type.type} className="drill-type">
              <div className="drill-type__head">
                <strong>{type.label}</strong>
                <Badge tone="neutral">{type.skill === 'LISTENING' ? 'Listening' : 'Reading'}</Badge>
              </div>
              <p>
                {type.questions} question{type.questions === 1 ? '' : 's'} across {type.groups} exercise{type.groups === 1 ? '' : 's'}.
              </p>
              <Button variant="primary" loading={starting === type.type} onClick={() => void start(type)}>
                Start drill
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** Server payload → the exam renderer's shapes. */
function paperGroup(group: DrillGroup): CandidateQuestionGroup {
  return {
    id: group.id,
    type: group.type,
    instructions: group.instructions,
    sharedOptions: group.sharedOptions,
    config: group.config,
    rangeFrom: null,
    rangeTo: null,
    questions: group.questions.map(paperQuestion),
  };
}

function paperQuestion(question: DrillGroup['questions'][number]): CandidateQuestion {
  return {
    id: question.id,
    number: question.number,
    prompt: question.prompt,
    options: question.options,
    config: question.config,
  };
}
