import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateQuestion, CandidateSection } from '@shared/question-types';
import { Button, Modal, Notice } from '../ui';
import { PassagePane } from './PassagePane';
import { AudioPlayer } from './AudioPlayer';
import { QuestionGroupHeader, GroupOptionBank, QuestionNavStrip, QuestionRenderer } from './QuestionRenderer';
import { WritingEditor } from './WritingEditor';
import { formatClock, MODE_LABELS, SKILL_LABELS } from '../../lib/format';
import { useToast } from '../ui';
import type { ExamSessionApi } from './useExamSession';

export function ExamShell({ session, onFinished }: { session: ExamSessionApi; onFinished: () => void }) {
  const { state } = session;
  const toast = useToast();
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<'PASSAGE' | 'QUESTIONS'>('QUESTIONS');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showUnansweredWarning, setShowUnansweredWarning] = useState(false);
  const [advancedToNext, setAdvancedToNext] = useState(false);
  const questionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const warnedRef = useRef<string | null>(null);

  const content = state?.content ?? null;
  const sections = useMemo(() => content?.sections ?? [], [content]);

  const allQuestions = useMemo(() => {
    return sections.flatMap((section) => section.groups.flatMap((group) => group.questions));
  }, [sections]);

  const objectiveQuestions = useMemo(
    () => allQuestions.filter((question) => !isEssay(question, sections)),
    [allQuestions, sections],
  );

  const answeredNumbers = useMemo(() => {
    const numbers = new Set<number>();
    if (!state) return numbers;
    for (const question of objectiveQuestions) {
      const response = state.answers[question.id];
      if (!response) continue;
      const values = 'values' in response ? response.values : [response.value];
      if (values.some((value) => String(value ?? '').trim().length > 0)) numbers.add(question.number);
    }
    for (const writing of state.writing) {
      const question = allQuestions.find((item) => item.id === writing.questionId);
      if (question && writing.text.trim().length > 0) numbers.add(question.number);
    }
    return numbers;
  }, [state, objectiveQuestions, allQuestions]);

  const flaggedNumbers = useMemo(() => {
    const numbers = new Set<number>();
    if (!state) return numbers;
    for (const questionId of state.flagged) {
      const question = allQuestions.find((item) => item.id === questionId);
      if (question) numbers.add(question.number);
    }
    return numbers;
  }, [state, allQuestions]);

  const unansweredCount = objectiveQuestions.length - answeredNumbers.size;
  const currentQuestion = allQuestions.find((question) => question.id === currentQuestionId) ?? null;
  const hasWritingTasks = sections.some((section) => section.writingTasks.length > 0);
  const isWritingSkill = state?.components[state.activeComponentIndex]?.skill === 'WRITING';
  const isWriting = isWritingSkill || (hasWritingTasks && !sections.some((section) => section.groups.some((group) => group.type !== 'WRITING_TASK_1' && group.type !== 'WRITING_TASK_2')));
  const activeSection = sections.find((section) => section.writingTasks.length > 0) ?? sections[0] ?? null;

  const jumpToQuestion = useCallback((number: number) => {
    const question = allQuestions.find((item) => item.number === number);
    if (!question) return;
    setCurrentQuestionId(question.id);
    setMobilePane('QUESTIONS');
    const element = document.getElementById(`q-${number}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (element?.querySelector('input, select, textarea') as HTMLElement | null)?.focus();
  }, [allQuestions]);

  // Keyboard navigation between questions (accessible exam controls).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const index = allQuestions.findIndex((question) => question.id === currentQuestionId);
        const nextIndex = event.key === 'ArrowDown' ? Math.min(allQuestions.length - 1, index + 1) : Math.max(0, index - 1);
        const next = allQuestions[nextIndex];
        if (next) jumpToQuestion(next.number);
      }
      if (event.altKey && event.key.toLowerCase() === 'f' && currentQuestionId) {
        event.preventDefault();
        session.toggleFlag(currentQuestionId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allQuestions, currentQuestionId, jumpToQuestion, session]);

  useEffect(() => {
    if (!state) return;
    if (state.integrity.warningLevel !== 'NONE' && warnedRef.current !== `${state.integrity.counted}`) {
      warnedRef.current = `${state.integrity.counted}`;
      toast.push(
        state.integrity.warningLevel === 'CRITICAL'
          ? 'Integrity threshold reached. This attempt may be submitted automatically.'
          : `Integrity event recorded (${state.integrity.counted} counted). Please stay on the exam page.`,
        state.integrity.warningLevel === 'CRITICAL' ? 'error' : 'warning',
      );
    }
  }, [state, toast]);

  if (!state || !state.content) {
    return (
      <div className="exam-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 520 }}>
          <h2>Preparing your test…</h2>
          <p className="muted">We are loading the server-authoritative attempt state.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (force = false) => {
    if (!force && unansweredCount > 0) {
      setShowUnansweredWarning(true);
      return;
    }
    setSubmitting(true);
    try {
      await session.submit({ confirmUnanswered: true });
      onFinished();
    } catch (submitError) {
      toast.push(submitError instanceof Error ? submitError.message : 'Submission failed. Please try again.', 'error');
    } finally {
      setSubmitting(false);
      setSubmitOpen(false);
      setShowUnansweredWarning(false);
    }
  };

  const timerTone =
    session.sessionRemainingSeconds !== null && session.sessionRemainingSeconds <= 300
      ? session.sessionRemainingSeconds <= 60
        ? 'exam-timer--critical'
        : 'exam-timer--warning'
      : '';

  const saveLabel =
    session.saveStatus === 'saving'
      ? 'Saving…'
      : session.saveStatus === 'saved'
        ? 'All answers saved'
        : session.saveStatus === 'offline'
          ? 'Offline — answers stored locally, retrying'
          : session.saveStatus === 'error'
            ? 'Save problem — check your connection'
            : 'Autosave active';

  return (
    <div className="exam-root">
      <header className="exam-topbar">
        <div>
          <div className="exam-topbar__title">{state.testTitle}</div>
          <div className="exam-topbar__sub">
            {state.components[state.activeComponentIndex]
              ? `${SKILL_LABELS[state.components[state.activeComponentIndex]!.skill]} · ${MODE_LABELS[state.mode]}`
              : ''}{' '}
            · v{state.versionNumber}
          </div>
        </div>

        {state.components.length > 1 ? (
          <div className="mock-progress" aria-label={`Section ${state.activeComponentIndex + 1} of ${state.components.length}`}>
            {state.components.map((component, index) => (
              <span key={component.sessionId} style={{ display: 'contents' }}>
                {index > 0 ? <span className="mock-progress__sep" aria-hidden="true" /> : null}
                <span
                  className={`mock-progress__step ${
                    index < state.activeComponentIndex
                      ? 'mock-progress__step--done'
                      : index === state.activeComponentIndex
                        ? 'mock-progress__step--current'
                        : ''
                  }`}
                >
                  <span aria-hidden="true">{index < state.activeComponentIndex ? '✓' : index === state.activeComponentIndex ? '●' : '○'}</span>
                  {SKILL_LABELS[component.skill] ?? component.label}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="exam-topbar__spacer" />

        <span className="tiny muted nowrap">{saveLabel}</span>

        {state.integrity.policy.showIndicator ? (
          <span
            className={`integrity-indicator ${
              state.integrity.warningLevel === 'CRITICAL'
                ? 'integrity-indicator--critical'
                : state.integrity.warningLevel === 'WARNING'
                  ? 'integrity-indicator--warning'
                  : ''
            }`}
            title={state.integrity.notice}
          >
            <span
              className={`dot ${
                state.integrity.warningLevel === 'CRITICAL'
                  ? 'dot--critical'
                  : state.integrity.warningLevel === 'WARNING'
                    ? 'dot--warning'
                    : ''
              }`}
            />
            {state.integrity.counted === 0 ? 'Monitoring active' : `${state.integrity.counted} event(s) recorded`}
          </span>
        ) : null}

        {!isWriting ? (
          <div className="exam-topbar__progress nowrap" title="Answered questions in this section">
            <span className="tiny muted">
              Answered {answeredNumbers.size}/{objectiveQuestions.length}
            </span>
            <div className="bar" style={{ width: 92, marginTop: 4 }}>
              <div
                className="bar__fill"
                style={{ width: `${objectiveQuestions.length > 0 ? (answeredNumbers.size / objectiveQuestions.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : null}

        {session.sessionRemainingSeconds !== null ? (
          <span className={`exam-timer ${timerTone}`} aria-live="off">
            {formatClock(session.sessionRemainingSeconds)}
          </span>
        ) : (
          <span className="tiny muted">Untimed</span>
        )}

        <Button variant="primary" onClick={() => setSubmitOpen(true)} disabled={submitting}>
          Submit test
        </Button>
      </header>

      {state.integrity.policy.requireFullscreen && !session.isFullscreen ? (
        <div style={{ padding: '10px 16px' }}>
          <Notice tone="warning" title="Fullscreen is required in this exam mode">
            <span>
              Fullscreen was exited or was not started. Fullscreen requests require a click, and this browser may also
              refuse them. Exits are recorded for your teacher.
            </span>
            <div style={{ marginTop: 8 }}>
              <Button size="sm" onClick={() => void session.requestFullscreen()}>
                Re-enter fullscreen
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}

      {session.warning ? (
        <div style={{ padding: '10px 16px' }}>
          <Notice tone="warning" title="Recorded event">
            <span>{session.warning}</span>
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="ghost" onClick={session.dismissWarning}>
                Dismiss
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}

      <div className="exam-mobile-tabs tabs" style={{ margin: '0 12px' }}>
        <button aria-selected={mobilePane === 'PASSAGE'} onClick={() => setMobilePane('PASSAGE')} type="button">
          {isWriting ? 'Task' : 'Passage / audio'}
        </button>
        <button aria-selected={mobilePane === 'QUESTIONS'} onClick={() => setMobilePane('QUESTIONS')} type="button">
          Questions
        </button>
      </div>

      <div className="exam-body">
        {!isWriting ? (
          <section
            className={`exam-pane exam-pane--passage ${mobilePane === 'QUESTIONS' ? 'pane-hidden-mobile' : ''}`}
            aria-label="Reading passage and audio"
          >
            <div className="exam-pane__header">
              <span className="exam-pane__title">
                {sections.some((section) => section.passage) ? 'Reading passage' : 'Listening'}
              </span>
              <span className="tiny muted">
                {sections.some((section) => section.passage)
                  ? 'Scroll independently — text is selectable'
                  : 'Audio plays according to the test policy'}
              </span>
            </div>
            {sections
              .filter((section) => section.audio)
              .map((section) => (
                <div key={section.id} style={{ padding: 16 }}>
                  <AudioPlayer
                    audio={section.audio!}
                    sectionTitle={section.title || 'Listening part'}
                    onEvent={(type, metadata) => session.logIntegrity(type, metadata)}
                  />
                  {section.instructions ? (
                    <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
                      {section.instructions}
                    </p>
                  ) : null}
                </div>
              ))}
            <PassagePane sections={sections} activeSectionId={activeSection?.id ?? null} />
          </section>
        ) : null}

        <section
          className={`exam-pane exam-pane--questions ${mobilePane === 'PASSAGE' && !isWriting ? 'pane-hidden-mobile' : ''}`}
        >
          <div className="exam-pane__header">
            <span className="exam-pane__title">{isWriting ? 'Writing tasks' : 'Questions'}</span>
            <span className="tiny muted">
              {isWriting ? 'Your response is saved automatically' : `${unansweredCount} unanswered`}
            </span>
          </div>

          <div className="exam-pane__scroll">
            {isWriting ? (
              <WritingEditor
                sections={sections}
                answers={state.writing}
                onSave={(questionId, text) => session.saveWriting(questionId, text)}
              />
            ) : (
              sections.map((section) => (
                <div key={section.id}>
                  {section.writingTasks.length > 0 ? (
                    <WritingEditor
                      sections={[section]}
                      answers={state.writing}
                      onSave={(questionId, text) => session.saveWriting(questionId, text)}
                    />
                  ) : null}
                  {section.groups.map((group) =>
                    group.type === 'WRITING_TASK_1' || group.type === 'WRITING_TASK_2' ? null : (
                    <div className="question-group" key={group.id} id={`group-${group.id}`}>
                      <QuestionGroupHeader group={group} onJump={() => group.rangeFrom && jumpToQuestion(group.rangeFrom)} />
                      <GroupOptionBank options={group.sharedOptions} numbering={group.config.optionNumbering} />
                      <div className="question-group__body">
                        {group.questions.map((question) => (
                          <div
                            key={question.id}
                            ref={(element) => {
                              if (element) questionRefs.current.set(question.id, element);
                            }}
                          >
                            <QuestionRenderer
                              group={group}
                              question={question}
                              response={state.answers[question.id] ?? null}
                              flagged={state.flagged.includes(question.id)}
                              active={currentQuestionId === question.id}
                              onAnswer={(questionId, response) => session.setAnswer(questionId, response)}
                              onToggleFlag={(questionId) => session.toggleFlag(questionId)}
                              onFocusQuestion={setCurrentQuestionId}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    ),
                  )}
                </div>
              ))
            )}
          </div>

        </section>
      </div>

      {!isWriting && allQuestions.length > 0 ? (
        <QuestionNavStrip
          numbers={allQuestions.map((question) => question.number)}
          answeredNumbers={answeredNumbers}
          flaggedNumbers={flaggedNumbers}
          currentNumber={currentQuestion?.number ?? null}
          onSelect={jumpToQuestion}
          extra={
            state.components.length > 1 && state.activeComponentIndex < state.components.length - 1 ? (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  if (!advancedToNext) {
                    setAdvancedToNext(true);
                    toast.push(
                      'Section time is running. Continue when you are ready — you cannot return to this section.',
                      'warning',
                    );
                    return;
                  }
                  await session.advanceComponent();
                  setAdvancedToNext(false);
                }}
              >
                {advancedToNext
                  ? 'Confirm: move to next section'
                  : `Next section (${state.components[state.activeComponentIndex + 1]?.label ?? ''})`}
              </Button>
            ) : null
          }
        />
      ) : null}

      <Modal
        open={submitOpen}
        title="Submit your test"
        onClose={() => setSubmitOpen(false)}
        actions={
          <>
            <Button onClick={() => setSubmitOpen(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => void handleSubmit(false)}>
              Submit test
            </Button>
          </>
        }
      >
        <p>
          You have answered <strong>{answeredNumbers.size}</strong> of <strong>{objectiveQuestions.length}</strong>{' '}
          questions.
          {unansweredCount > 0 ? (
            <>
              {' '}
              <strong>{unansweredCount}</strong> question{unansweredCount === 1 ? ' is' : 's are'} still unanswered.
            </>
          ) : null}
        </p>
        <p className="muted small">
          Answers lock after submission and cannot be changed. Objective sections are marked on the server; Writing tasks
          are reviewed by your teacher.
        </p>
      </Modal>

      <Modal
        open={showUnansweredWarning}
        title="Unanswered questions"
        onClose={() => setShowUnansweredWarning(false)}
      >
        <UnansweredWarning
          count={unansweredCount}
          onCancel={() => setShowUnansweredWarning(false)}
          onConfirm={() => void handleSubmit(true)}
        />
      </Modal>
    </div>
  );
}

function UnansweredWarning({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="stack">
      <p>
        You still have <strong>{count}</strong> unanswered question{count === 1 ? '' : 's'}. Unanswered questions score
        zero, and answers cannot be changed after submission.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={onCancel}>Keep working</Button>
        <Button variant="primary" onClick={onConfirm}>
          Submit anyway
        </Button>
      </div>
    </div>
  );
}

function isEssay(question: CandidateQuestion, sections: CandidateSection[]): boolean {
  return sections.some((section) => section.writingTasks.some((task) => task.id === question.id));
}
