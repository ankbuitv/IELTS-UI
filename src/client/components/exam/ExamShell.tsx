import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CandidateQuestion, CandidateSection } from '@shared/question-types';
import type { AttemptSectionState } from '@shared/candidate';
import { DEFAULT_SECTION_POLICY, type SectionPolicy } from '@shared/sections';
import { Button, Modal, Notice } from '../ui';
import { BrandLogo } from '../BrandLogo';
import { Icon } from '../Icon';
import { PassagePane } from './PassagePane';
import { AudioPlayer } from './AudioPlayer';
import { QuestionGroupHeader, GroupOptionBank, QuestionRenderer } from './QuestionRenderer';
import { TranscriptView } from './TranscriptView';
import { WritingEditor } from './WritingEditor';
import { formatClock, MODE_LABELS, SKILL_LABELS } from '../../lib/format';
import { useToast } from '../ui';
import type { ExamSessionApi } from './useExamSession';

export function ExamShell({ session, onFinished }: { session: ExamSessionApi; onFinished: () => void }) {
  const { state } = session;
  const toast = useToast();
  const navigate = useNavigate();
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [paneMode, setPaneMode] = useState<PaneMode>(readStoredPaneMode);
  const [passageWidth, setPassageWidth] = useState<number>(readStoredPassageWidth);
  const examBodyRef = useRef<HTMLDivElement | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showUnansweredWarning, setShowUnansweredWarning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [advancedToNext, setAdvancedToNext] = useState(false);
  const [highlightSegmentId] = useState<string | null>(null);
  const questionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const warnedRef = useRef<string | null>(null);

  const content = state?.content ?? null;
  const sections = useMemo(() => content?.sections ?? [], [content]);
  const sectionPolicy: SectionPolicy = state?.sectionPolicy ?? DEFAULT_SECTION_POLICY;
  const sectionProgress: AttemptSectionState[] = state?.sections ?? [];

  const allQuestions = useMemo(() => {
    return sections.flatMap((section) => section.groups.flatMap((group) => group.questions));
  }, [sections]);

  const questionsBySection = useMemo(() => {
    const map = new Map<string, CandidateQuestion[]>();
    for (const section of sections) {
      map.set(
        section.id,
        section.groups.flatMap((group) => group.questions),
      );
    }
    return map;
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

  // ---------------------------------------------------------------------
  // 34. Section navigation: server progress decides the default part and,
  // in sequential modes, which parts are open. Free navigation allows every
  // part at any time. Attempts without stored section rows (legacy) are free.
  // ---------------------------------------------------------------------
  const defaultSectionId = useMemo(() => {
    if (sections.length === 0) return null;
    const inProgress = sectionProgress.find((row) => row.status === 'IN_PROGRESS');
    if (inProgress && sections.some((section) => section.id === inProgress.sectionId)) return inProgress.sectionId;
    return sections[0]!.id;
  }, [sections, sectionProgress]);

  const [pickedSectionId, setPickedSectionId] = useState<string | null>(null);
  const activeSectionId =
    pickedSectionId && sections.some((section) => section.id === pickedSectionId)
      ? pickedSectionId
      : defaultSectionId;
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null;

  const isSectionOpen = useCallback(
    (sectionId: string): boolean => {
      if (sectionPolicy.navigation === 'FREE_NAVIGATION' || sectionProgress.length === 0) return true;
      const progress = sectionProgress.find((row) => row.sectionId === sectionId);
      if (!progress) return true;
      if (progress.status === 'IN_PROGRESS') return true;
      if (progress.status === 'COMPLETED') return sectionPolicy.allowReturnToPreviousParts;
      return false; // NOT_STARTED parts open in order in sequential modes
    },
    [sectionPolicy, sectionProgress],
  );

  const activeSectionQuestions = useMemo(
    () => (activeSection ? questionsBySection.get(activeSection.id) ?? [] : []),
    [activeSection, questionsBySection],
  );

  const activeObjectiveQuestions = useMemo(
    () => activeSectionQuestions.filter((question) => !isEssay(question, sections)),
    [activeSectionQuestions, sections],
  );

  const unansweredCount = objectiveQuestions.length - answeredNumbers.size;
  const activeUnansweredCount = activeObjectiveQuestions.filter((question) => !answeredNumbers.has(question.number)).length;
  const currentQuestion = allQuestions.find((question) => question.id === currentQuestionId) ?? null;
  const isWritingSection = Boolean(activeSection && (activeSection.skill === 'WRITING' || activeSection.writingTasks.length > 0));
  const hasWritingTasks = sections.some((section) => section.writingTasks.length > 0);
  const isWriting = isWritingSection || (hasWritingTasks && !sections.some((section) => section.groups.some((group) => group.type !== 'WRITING_TASK_1' && group.type !== 'WRITING_TASK_2')));

  const jumpToQuestion = useCallback((number: number) => {
    const question = allQuestions.find((item) => item.number === number);
    if (!question) return;
    setCurrentQuestionId(question.id);
    // Jumping to a question is useless if the question pane is hidden.
    setPaneMode((mode) => (mode === 'PASSAGE' ? 'QUESTIONS' : mode));
    const element = document.getElementById(`q-${number}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (element?.querySelector('input, select, textarea') as HTMLElement | null)?.focus();
  }, [allQuestions]);



  const switchToSection = useCallback(
    (sectionId: string) => {
      if (!isSectionOpen(sectionId)) {
        toast.push('This part is not open yet. Complete the current part first.', 'warning');
        return;
      }
      setPickedSectionId(sectionId);
      setDrawerOpen(false);
      const firstQuestion = (questionsBySection.get(sectionId) ?? [])[0];
      if (firstQuestion) setCurrentQuestionId(firstQuestion.id);
    },
    [isSectionOpen, questionsBySection, toast],
  );

  /** Step to the next / previous question, crossing into the neighbouring part. */
  const stepQuestion = useCallback(
    (direction: 1 | -1) => {
      const ordered = sections.flatMap((section) => questionsBySection.get(section.id) ?? []);
      if (ordered.length === 0) return;
      const index = ordered.findIndex((question) => question.id === currentQuestionId);
      const next = ordered[index === -1 ? 0 : Math.min(ordered.length - 1, Math.max(0, index + direction))];
      if (!next) return;
      const owner = sections.find((section) => section.questionNumbers.includes(next.number));
      if (owner && owner.id !== activeSection?.id) switchToSection(owner.id);
      jumpToQuestion(next.number);
    },
    [sections, questionsBySection, currentQuestionId, activeSection?.id, switchToSection, jumpToQuestion],
  );

  // Keep the picked section aligned with server-driven auto-advance (e.g. a
  // part timer expired and the policy advanced the attempt automatically).
  useEffect(() => {
    setPickedSectionId((picked) => {
      if (!picked) return picked;
      const progress = sectionProgress.find((row) => row.sectionId === picked);
      if (progress && progress.status === 'IN_PROGRESS') return picked;
      if (sectionPolicy.navigation === 'FREE_NAVIGATION') return picked;
      return null; // fall back to the server's current part
    });
  }, [sectionProgress, sectionPolicy.navigation]);

  // Keyboard navigation between questions (accessible exam controls).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const index = activeSectionQuestions.findIndex((question) => question.id === currentQuestionId);
        const nextIndex = event.key === 'ArrowDown' ? Math.min(activeSectionQuestions.length - 1, index + 1) : Math.max(0, index - 1);
        const next = activeSectionQuestions[nextIndex];
        if (next) jumpToQuestion(next.number);
      }
      if (event.altKey && event.key.toLowerCase() === 'f' && currentQuestionId) {
        event.preventDefault();
        session.toggleFlag(currentQuestionId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSectionQuestions, currentQuestionId, jumpToQuestion, session]);

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

  const sequential = sectionPolicy.navigation !== 'FREE_NAVIGATION' && sectionProgress.length > 0;
  const nextClosedSection = sequential
    ? sections.find((section) => {
        const progress = sectionProgress.find((row) => row.sectionId === section.id);
        return progress ? progress.status === 'NOT_STARTED' : false;
      }) ?? null
    : null;
  const activeProgress = activeSection ? sectionProgress.find((row) => row.sectionId === activeSection.id) ?? null : null;

  return (
    <div className={`exam-root ${allQuestions.length > 0 ? 'exam-root--has-bottombar' : ''}`}>
      <header className="exam-topbar">
        <button
          type="button"
          className="exam-topbar__icon exam-topbar__icon--exit"
          onClick={() => setExitOpen(true)}
          aria-label="Leave the test"
          title="Leave the test"
        >
          <Icon name="close" size={18} />
        </button>

        <BrandLogo height={28} />

        <div className="exam-topbar__heading">
          <div className="exam-topbar__title">
            <span className="exam-topbar__eyebrow">Test in progress</span>
            {state.testTitle}
          </div>
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
          <span className="exam-topbar__count nowrap" title="Questions answered in this test">
            {answeredNumbers.size}/{objectiveQuestions.length} answered
          </span>
        ) : null}

        <button
          type="button"
          className="btn btn--sm exam-topbar__vocab nowrap"
          onClick={() => navigate('/vocabulary')}
          title="Vocabulary notebook"
        >
          <Icon name="book" size={14} />
          Học từ vựng
        </button>

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

      {sections.length > 1 ? (
        <nav className="exam-sections" aria-label="Test sections">
          <span className="exam-sections__hint">Sections</span>
          <div className="exam-sections__tabs" role="tablist">
            {sections.map((section, index) => {
              const progress = sectionProgress.find((row) => row.sectionId === section.id) ?? null;
              const sectionQuestionIds = questionsBySection.get(section.id) ?? [];
              const answeredInSection =
                progress?.answeredCount ??
                sectionQuestionIds.filter((question) => answeredNumbers.has(question.number)).length;
              const totalInSection = progress?.totalQuestions ?? sectionQuestionIds.length;
              const open = isSectionOpen(section.id);
              const current = section.id === activeSection?.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  className={[
                    'exam-sections__tab',
                    current ? 'exam-sections__tab--current' : '',
                    progress?.status === 'COMPLETED' ? 'exam-sections__tab--done' : '',
                    !open ? 'exam-sections__tab--locked' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => switchToSection(section.id)}
                  aria-selected={current}
                  aria-current={current ? 'true' : undefined}
                  title={open ? section.title || section.label : 'This part is not open yet'}
                >
                  <span className="exam-sections__tab-name">
                    {progress?.status === 'COMPLETED' ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
                    {!open ? <Icon name="lock" size={13} /> : null}
                    {section.label}
                  </span>
                  <span className="exam-sections__tab-count">
                    {section.skill === 'WRITING'
                      ? state.writing.some((entry) =>
                          section.writingTasks.some((task) => task.id === entry.questionId && entry.text.trim().length > 0),
                        )
                        ? 'done'
                        : '0/' + section.writingTasks.length
                      : `${answeredInSection}/${totalInSection}`}
                  </span>
                  {progress?.status === 'IN_PROGRESS' && progress.remainingSeconds !== null ? (
                    <span
                      className={`exam-sections__tab-timer ${
                        progress.remainingSeconds <= 60 ? 'exam-sections__tab-timer--critical' : ''
                      }`}
                    >
                      {formatClock(progress.remainingSeconds)}
                    </span>
                  ) : (
                    <span className="exam-sections__tab-index">{index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      <div className="exam-view" role="group" aria-label="Exam layout">
        <span className="exam-view__label">View</span>
        {(
          [
            { mode: 'SPLIT', label: isWriting ? 'Task & answer' : 'Passage & questions', icon: 'layers' },
            { mode: 'PASSAGE', label: isWriting ? 'Task only' : 'Passage only', icon: 'book' },
            { mode: 'QUESTIONS', label: 'Questions only', icon: 'list' },
          ] as const
        ).map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`exam-view__option ${paneMode === option.mode ? 'exam-view__option--on' : ''}`}
            aria-pressed={paneMode === option.mode}
            onClick={() => {
              setPaneMode(option.mode);
              storePaneMode(option.mode);
            }}
            title={option.label}
          >
            <Icon name={option.icon} size={14} />
            <span className="exam-view__text">{option.label}</span>
          </button>
        ))}
      </div>

      <div
        className={`exam-body ${paneMode === 'SPLIT' ? 'exam-body--split' : 'exam-body--single'}`}
        ref={examBodyRef}
        style={paneMode === 'SPLIT' ? ({ '--passage-share': `${passageWidth}%` } as CSSProperties) : undefined}
      >
        {!isWriting && paneMode !== 'QUESTIONS' ? (
          <section className="exam-pane exam-pane--passage" aria-label="Reading passage and audio">
            <div className="exam-pane__header">
              <span className="exam-pane__title">{activeSection?.label || (activeSection?.passage ? 'Reading passage' : 'Listening')}</span>
              <span className="tiny muted">
                {activeSection?.passage
                  ? 'Scroll independently — text is selectable'
                  : 'Audio plays according to the test policy'}
              </span>
            </div>
            {activeSection?.description ? (
              <p className="small muted" style={{ padding: '10px 16px 0' }}>
                {activeSection.description}
              </p>
            ) : null}
            {activeSection?.audio ? (
              <div style={{ padding: 16 }}>
                <AudioPlayer
                  audio={activeSection.audio}
                  sectionTitle={activeSection.title || 'Listening part'}
                  onEvent={(type, metadata) => session.logIntegrity(type, metadata)}
                />
              </div>
            ) : null}
            {activeSection?.image ? (
              <div style={{ padding: '0 16px 12px' }}>
                <img
                  src={activeSection.image.url}
                  alt={activeSection.image.altText ?? `Image for ${activeSection.label}`}
                  style={{ maxWidth: '100%', borderRadius: 8 }}
                />
              </div>
            ) : null}
            {activeSection ? (
              <PassagePane sections={[activeSection]} activeSectionId={activeSection.id} showInstructions>
                {activeSection.transcript && activeSection.transcript.segments.length > 0 ? (
                  <section className="exam-pane__section" aria-label="Transcript">
                    <div className="exam-pane__section-head">
                      <span className="exam-pane__section-title">Transcript</span>
                      <span className="tiny muted">Released with the review material</span>
                    </div>
                    <TranscriptView transcript={activeSection.transcript} highlightSegmentId={highlightSegmentId} />
                  </section>
                ) : null}
              </PassagePane>
            ) : null}
          </section>
        ) : null}

        {!isWriting && paneMode === 'SPLIT' ? (
          <div
            className="exam-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the passage and question panes"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const body = examBodyRef.current;
              if (!body) return;
              const rect = body.getBoundingClientRect();
              if (rect.width === 0) return;
              const share = ((event.clientX - rect.left) / rect.width) * 100;
              const clamped = Math.min(72, Math.max(26, share));
              setPassageWidth(clamped);
              storePassageWidth(clamped);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          />
        ) : null}

        <section className="exam-pane exam-pane--questions">
          <div className="exam-pane__header">
            <span className="exam-pane__title">{isWriting ? activeSection?.label || 'Writing tasks' : 'Questions'}</span>
            <span className="tiny muted">
              {isWriting
                ? 'Your response is saved automatically'
                : `${activeUnansweredCount} unanswered in ${activeSection?.label ?? 'this part'}`}
            </span>
          </div>

          <div className="exam-pane__scroll">
            {activeSection ? (
              isWritingSection ? (
                <WritingEditor
                  sections={[activeSection]}
                  answers={state.writing}
                  onSave={(questionId, text) => session.saveWriting(questionId, text)}
                />
              ) : (
                <>
                  {activeSection.writingTasks.length > 0 ? (
                    <WritingEditor
                      sections={[activeSection]}
                      answers={state.writing}
                      onSave={(questionId, text) => session.saveWriting(questionId, text)}
                    />
                  ) : null}
                  {activeSection.groups.map((group) =>
                    group.type === 'WRITING_TASK_1' || group.type === 'WRITING_TASK_2' ? null : (
                      <div className="question-block" key={group.id} id={`group-${group.id}`}>
                        <QuestionGroupHeader group={group} onJump={() => group.rangeFrom && jumpToQuestion(group.rangeFrom)} />
                        <div className="question-group">
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
                      </div>
                    ),
                  )}
                </>
              )
            ) : null}
          </div>

        </section>
      </div>

      {allQuestions.length > 0 ? (
        <nav className="exam-bottombar" aria-label="Question navigation">
          <button
            type="button"
            className="exam-bottombar__icon"
            onClick={() => setDrawerOpen(true)}
            title="Question palette"
            aria-label="Question palette"
          >
            <Icon name="grid" size={18} />
          </button>

          <button type="button" className="btn btn--sm" onClick={() => setDrawerOpen(true)}>
            All questions
          </button>

          <span className="exam-bottombar__score nowrap" title="Answered questions">
            <Icon name="check" size={14} strokeWidth={2.6} />
            {answeredNumbers.size} / {objectiveQuestions.length}
          </span>

          <div className="exam-bottombar__sections">
            {sections.map((section) => {
              const progress = sectionProgress.find((row) => row.sectionId === section.id) ?? null;
              const numbers = questionsBySection.get(section.id) ?? [];
              const answeredInSection =
                progress?.answeredCount ?? numbers.filter((question) => answeredNumbers.has(question.number)).length;
              const current = section.id === activeSection?.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`exam-bottombar__tab ${current ? 'exam-bottombar__tab--current' : ''}`}
                  onClick={() => switchToSection(section.id)}
                  aria-current={current ? 'true' : undefined}
                >
                  {current ? (
                    <span className="exam-bottombar__tab-label">
                      {section.label}
                      <span className="exam-bottombar__tab-count">
                        {answeredInSection}/{numbers.length}
                      </span>
                    </span>
                  ) : (
                    <span className="exam-bottombar__tab-index">{sections.indexOf(section) + 1}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="exam-bottombar__spacer" />

          <Button size="sm" onClick={() => stepQuestion(-1)} disabled={isWriting}>
            Previous
          </Button>

          {nextClosedSection && activeProgress?.status === 'IN_PROGRESS' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                if (!advancedToNext) {
                  setAdvancedToNext(true);
                  toast.push(
                    sectionPolicy.allowReturnToPreviousParts
                      ? 'You can return to earlier parts while time remains.'
                      : 'You cannot return to this part after continuing.',
                    'warning',
                  );
                  return;
                }
                await session.completeSection(activeSection?.id);
                setAdvancedToNext(false);
              }}
            >
              {advancedToNext ? 'Confirm: continue' : `Continue to ${nextClosedSection.label}`}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => stepQuestion(1)} disabled={isWriting}>
              Next
            </Button>
          )}
        </nav>
      ) : null}

      <Modal open={exitOpen} title="Leave the test?" onClose={() => setExitOpen(false)}>
        <div className="stack">
          <p>
            Your answers are saved automatically and stay attached to this attempt. Timed sections keep running while
            you are away, and leaving the tab is recorded in the integrity log for your teacher.
          </p>
          <p className="small muted">You can come back to this attempt from “My tests” at any time before it closes.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setExitOpen(false)}>Keep working</Button>
            <Button variant="primary" onClick={() => void navigate('/history')}>
              Save &amp; exit
            </Button>
          </div>
        </div>
      </Modal>

      <AllQuestionsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sections={sections}
        answeredNumbers={answeredNumbers}
        flaggedNumbers={flaggedNumbers}
        currentNumber={currentQuestion?.number ?? null}
        activeSectionId={activeSection?.id ?? null}
        sectionProgress={sectionProgress}
        onSelect={(number) => {
          // Jumping to a question may require opening its section first.
          const owner = sections.find((section) => section.questionNumbers.includes(number));
          if (owner && owner.id !== activeSection?.id) switchToSection(owner.id);
          jumpToQuestion(number);
        }}
      />

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

/** How the exam body is laid out; the candidate picks, we remember. */
type PaneMode = 'SPLIT' | 'PASSAGE' | 'QUESTIONS';

function readStoredPaneMode(): PaneMode {
  try {
    const stored = window.localStorage.getItem('exam.paneMode');
    if (stored === 'SPLIT' || stored === 'PASSAGE' || stored === 'QUESTIONS') return stored;
  } catch {
    // Private modes can refuse storage; fall through to the width default.
  }
  // Side by side whenever there is room for two readable columns; a narrow
  // phone opens on the questions because two columns are unusable there.
  return typeof window !== 'undefined' && window.innerWidth >= 560 ? 'SPLIT' : 'QUESTIONS';
}

function storePaneMode(mode: PaneMode): void {
  try {
    window.localStorage.setItem('exam.paneMode', mode);
  } catch {
    // Not fatal: the layout still applies for this session.
  }
}

function readStoredPassageWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem('exam.passageWidth'));
    if (Number.isFinite(stored) && stored >= 26 && stored <= 72) return stored;
  } catch {
    // Ignore and use the default split.
  }
  return 50;
}

function storePassageWidth(value: number): void {
  try {
    window.localStorage.setItem('exam.passageWidth', String(Math.round(value)));
  } catch {
    // Not fatal.
  }
}

function isEssay(question: CandidateQuestion, sections: CandidateSection[]): boolean {
  return sections.some((section) => section.writingTasks.some((task) => task.id === question.id));
}

/**
 * 35. All Questions drawer: every question grouped under its section/part
 * label, with unanswered / answered / current / flagged visual states.
 */
export function AllQuestionsDrawer({
  open,
  onClose,
  sections,
  answeredNumbers,
  flaggedNumbers,
  currentNumber,
  activeSectionId,
  sectionProgress,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  sections: CandidateSection[];
  answeredNumbers: Set<number>;
  flaggedNumbers: Set<number>;
  currentNumber: number | null;
  activeSectionId: string | null;
  sectionProgress: AttemptSectionState[];
  onSelect: (number: number) => void;
}) {
  return (
    <Modal
      open={open}
      title="All questions"
      onClose={onClose}
      actions={
        <Button onClick={onClose}>Close</Button>
      }
    >
      <div className="stack">
        {sections.map((section) => {
          const progress = sectionProgress.find((row) => row.sectionId === section.id) ?? null;
          const numbers = section.questionNumbers;
          const answeredInSection = numbers.filter((number) => answeredNumbers.has(number)).length;
          return (
            <div key={section.id} className="stack" style={{ gap: 6 }}>
              <div className="row row--between">
                <strong className={section.id === activeSectionId ? 'text-accent' : ''}>{section.label}</strong>
                <span className="tiny muted">
                  {section.skill === 'WRITING'
                    ? `${section.writingTasks.length} task${section.writingTasks.length === 1 ? '' : 's'}`
                    : `${answeredInSection}/${numbers.length} answered`}
                  {progress && progress.status === 'COMPLETED' ? ' · completed' : ''}
                </span>
              </div>
              {section.skill === 'WRITING' ? (
                <p className="tiny muted">{section.writingTasks.map((task) => (task.config.note ? String(task.config.note) : `Task ${task.number}`)).join(' · ') || 'Writing task'}</p>
              ) : (
                <div className="nav-strip" role="list" aria-label={`${section.label} questions`}>
                  {numbers.map((number) => (
                    <button
                      key={number}
                      type="button"
                      role="listitem"
                      className={[
                        'nav-strip__item',
                        answeredNumbers.has(number) ? 'nav-strip__item--answered' : '',
                        flaggedNumbers.has(number) ? 'nav-strip__item--flagged' : '',
                        currentNumber === number ? 'nav-strip__item--current' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => onSelect(number)}
                      aria-label={`Question ${number}${answeredNumbers.has(number) ? ', answered' : ', unanswered'}${
                        flaggedNumbers.has(number) ? ', flagged' : ''
                      }`}
                    >
                      {number}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
