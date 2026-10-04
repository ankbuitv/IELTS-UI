import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CandidateQuestion, CandidateSection } from '@shared/question-types';
import type { AttemptSectionState } from '@shared/candidate';
import { DEFAULT_SECTION_POLICY, type SectionPolicy } from '@shared/sections';
import { Button, Modal, skillClass } from '../ui';
import { Icon, type IconName } from '../Icon';
import { PassagePane } from './PassagePane';
import { AudioPlayer } from './AudioPlayer';
import { QuestionGroupHeader, GroupOptionBank, QuestionRenderer } from './QuestionRenderer';
import { SectionImage } from './SectionImage';
import { TranscriptView } from './TranscriptView';
import { WritingAnswer, WritingPrompt, writingTasksOf } from './WritingEditor';
import { formatClock, MODE_LABELS, SKILL_LABELS } from '../../lib/format';
import { DisplayMenu } from '../DisplayMenu';
import { useToast } from '../ui';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { ExamSessionApi } from './useExamSession';
import { ExamDictionary } from './ExamDictionary';
import { TabLockOverlay } from './TabLockOverlay';
import { useExamViewportLock } from './useExamViewport';
import { useInputLockdown } from '../../hooks/useInputLockdown';

export function ExamShell({ session, onFinished }: { session: ExamSessionApi; onFinished: () => void }) {
  // The exam owns the viewport: only its panes scroll (see exam.css).
  useExamViewportLock();
  // The exam's input surface: shortcuts, the right-click menu, drag-to-copy, and
  // a measurement of whether a debugger is attached. An open inspector covers the
  // page until it is closed and is written to the integrity log as an observable
  // event — never as a counted strike, because an extension can trip it too.
  useInputLockdown({
    onInspectorChange: (open) => session.logIntegrity(open ? 'INSPECTOR_OPEN' : 'INSPECTOR_CLOSED', { source: 'lockdown-probe' }),
  });

  const { state } = session;
  const toast = useToast();
  const navigate = useNavigate();
  /** Phone-sized: one pane at a time, switched with Passage | Questions. */
  const compact = useMediaQuery('(max-width: 719px)');
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null);
  const [paneMode, setPaneMode] = useState<PaneMode>(readStoredPaneMode);
  const [compactMode, setCompactMode] = useState<'PASSAGE' | 'QUESTIONS'>('QUESTIONS');
  const [passageWidth, setPassageWidth] = useState<number>(readStoredPassageWidth);
  const examBodyRef = useRef<HTMLDivElement | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showUnansweredWarning, setShowUnansweredWarning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [advancedToNext, setAdvancedToNext] = useState(false);
  const [highlightSegmentId] = useState<string | null>(null);
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null);
  const warnedRef = useRef<string | null>(null);

  const mode: PaneMode = compact ? compactMode : paneMode;
  const setView = useCallback(
    (next: PaneMode) => {
      if (compact) {
        setCompactMode(next === 'PASSAGE' ? 'PASSAGE' : 'QUESTIONS');
      } else {
        setPaneMode(next);
        storePaneMode(next);
      }
    },
    [compact],
  );

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

  const answeredNumbers = useMemo(() => {
    const numbers = new Set<number>();
    if (!state) return numbers;
    for (const question of allQuestions) {
      if (isEssay(question, sections)) continue;
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
  }, [state, allQuestions, sections]);

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

  const unansweredCount = Math.max(0, allQuestions.length - answeredNumbers.size);
  const currentQuestion = allQuestions.find((question) => question.id === currentQuestionId) ?? null;
  const isWriting = Boolean(activeSection && (activeSection.skill === 'WRITING' || activeSection.writingTasks.length > 0));
  const writingTasks = useMemo(() => (activeSection ? writingTasksOf([activeSection]) : []), [activeSection]);
  const activeTaskId = pickedTaskId && writingTasks.some((item) => item.task.id === pickedTaskId) ? pickedTaskId : writingTasks[0]?.task.id ?? null;
  const activeTask = writingTasks.find((item) => item.task.id === activeTaskId) ?? null;

  const jumpToQuestion = useCallback(
    (number: number) => {
      const question = allQuestions.find((item) => item.number === number);
      if (!question) return;
      setCurrentQuestionId(question.id);
      // Jumping to a question is useless if the question pane is hidden.
      if (compact) setCompactMode('QUESTIONS');
      else setPaneMode((current) => (current === 'PASSAGE' ? 'QUESTIONS' : current));
      // Wait a frame so the pane (and a part we just switched to) is rendered.
      window.requestAnimationFrame(() => scrollQuestionIntoView(number));
    },
    [allQuestions, compact],
  );

  const switchToSection = useCallback(
    (sectionId: string) => {
      if (!isSectionOpen(sectionId)) {
        toast.push('This part is not open yet. Complete the current part first.', 'warning');
        return;
      }
      setPickedSectionId(sectionId);
      setPickedTaskId(null);
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

  /** Writing parts have no questions to step through: Previous/Next move between parts. */
  const stepPart = useCallback(
    (direction: 1 | -1) => {
      const index = sections.findIndex((section) => section.id === activeSection?.id);
      const target = sections[index + direction];
      if (target) switchToSection(target.id);
    },
    [sections, activeSection?.id, switchToSection],
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
    // After the tab lock submits the attempt the server stops sending the paper, but the
    // candidate must still get to read why: the notice is the way out to the results.
    return (
      <div className="exam-root exam-root--center">
        {session.tabLock ? (
          <TabLockOverlay lock={session.tabLock} onReturn={session.acknowledgeTabLock} onViewResults={onFinished} />
        ) : (
          <div className="card" style={{ maxWidth: 420 }}>
            <h2>Preparing your test…</h2>
            <p className="muted">Loading your attempt from the server.</p>
          </div>
        )}
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

  const leaveTest = async () => {
    setLeaving(true);
    // Everything typed so far must reach the server before the page goes away.
    const saved = await session.flushAll();
    setLeaving(false);
    if (!saved) {
      toast.push('Some answers have not been saved yet. Check your connection, or stay and keep working.', 'warning');
      return;
    }
    void navigate('/history');
  };

  const timerTone =
    session.sessionRemainingSeconds !== null && session.sessionRemainingSeconds <= 300
      ? session.sessionRemainingSeconds <= 60
        ? 'exam-timer--critical'
        : 'exam-timer--warning'
      : '';

  const saveTone =
    session.saveStatus === 'error' ? 'bad' : session.saveStatus === 'offline' ? 'warn' : session.saveStatus === 'saving' ? 'busy' : 'ok';
  const saveLabel =
    session.saveStatus === 'saving'
      ? 'Saving…'
      : session.saveStatus === 'saved'
        ? 'Saved'
        : session.saveStatus === 'offline'
          ? 'Offline — will retry'
          : session.saveStatus === 'error'
            ? 'Not saved'
            : 'Autosave on';

  const sequential = sectionPolicy.navigation !== 'FREE_NAVIGATION' && sectionProgress.length > 0;
  const nextClosedSection = sequential
    ? sections.find((section) => {
        const progress = sectionProgress.find((row) => row.sectionId === section.id);
        return progress ? progress.status === 'NOT_STARTED' : false;
      }) ?? null
    : null;
  const activeProgress = activeSection ? sectionProgress.find((row) => row.sectionId === activeSection.id) ?? null : null;
  const activeIndex = sections.findIndex((section) => section.id === activeSection?.id);
  const answeredTotal = answeredNumbers.size;
  const total = allQuestions.length;
  const skillLabel = state.components[state.activeComponentIndex]
    ? SKILL_LABELS[state.components[state.activeComponentIndex]!.skill]
    : SKILL_LABELS[state.testType] ?? '';

  const viewOptions: Array<{ mode: PaneMode; label: string; icon: IconName }> = [
    ...(compact ? [] : [{ mode: 'SPLIT' as const, label: 'Split', icon: 'layers' as const }]),
    { mode: 'PASSAGE', label: isWriting ? 'Task' : activeSection?.passage || !activeSection?.audio ? 'Passage' : 'Audio', icon: isWriting ? 'file' : 'book' },
    { mode: 'QUESTIONS', label: isWriting ? 'Answer' : 'Questions', icon: isWriting ? 'pen' : 'list' },
  ];

  const showMaterial = mode !== 'QUESTIONS';
  const showWork = mode !== 'PASSAGE';

  return (
    <div className="exam-root">
      <header className="exam-topbar">
        <button
          type="button"
          className="exam-icon exam-icon--exit"
          onClick={() => setExitOpen(true)}
          aria-label="Leave the test"
          title="Leave the test"
        >
          <Icon name="close" size={18} />
        </button>

        <div className="exam-topbar__heading">
          <div className="exam-topbar__title" title={state.testTitle}>
            {state.testTitle}
          </div>
          <div className="exam-topbar__sub">
            {skillLabel} · {MODE_LABELS[state.mode]}
          </div>
        </div>

        {state.components.length > 1 ? (
          <div className="mock-progress" aria-label={`Section ${state.activeComponentIndex + 1} of ${state.components.length}`}>
            {state.components.map((component, index) => {
              const stepState =
                index < state.activeComponentIndex ? 'done' : index === state.activeComponentIndex ? 'current' : 'upcoming';
              return (
                <span
                  key={component.sessionId}
                  className={`mock-progress__step ${
                    stepState === 'done' ? 'mock-progress__step--done' : stepState === 'current' ? 'mock-progress__step--current' : ''
                  }`}
                  aria-current={stepState === 'current' ? 'step' : undefined}
                  title={`${SKILL_LABELS[component.skill] ?? component.label} — ${
                    stepState === 'done' ? 'completed' : stepState === 'current' ? 'in progress' : 'up next'
                  }`}
                >
                  {stepState === 'done' ? <Icon name="check" size={11} strokeWidth={3} /> : <span className="mock-progress__dot" />}
                  {SKILL_LABELS[component.skill] ?? component.label}
                </span>
              );
            })}
          </div>
        ) : null}

        <div className="exam-topbar__actions">
          <span className={`exam-save exam-save--${saveTone}`} role="status" title={saveLabel}>
            <span className="exam-save__dot" aria-hidden="true" />
            <span className="exam-save__text">{saveLabel}</span>
          </span>

          {state.integrity.policy.showIndicator ? (
            <span
              className={`exam-integrity ${
                state.integrity.warningLevel === 'CRITICAL'
                  ? 'exam-integrity--critical'
                  : state.integrity.warningLevel === 'WARNING'
                    ? 'exam-integrity--warning'
                    : ''
              }`}
              title={state.integrity.notice}
            >
              <Icon name="shield" size={14} />
              <span className="exam-integrity__text">
                {state.integrity.policy.autoSubmitAtEvents
                  ? `Tab lock ${Math.min(Math.max(state.integrity.counted, session.tabStrikes), state.integrity.policy.autoSubmitAtEvents)}/${state.integrity.policy.autoSubmitAtEvents}`
                  : state.integrity.counted === 0
                    ? 'Monitored'
                    : `${state.integrity.counted} event${state.integrity.counted === 1 ? '' : 's'}`}
              </span>
            </span>
          ) : null}

          {/* Text size / spacing / theme, reachable mid-exam on a phone. */}
          <DisplayMenu compact />

          {state.integrity.policy.mode === 'PRACTICE' ? (
            <button
              type="button"
              className={`exam-icon exam-icon--vocab${dictionaryOpen ? ' is-on' : ''}`}
              data-dictionary-toggle
              onClick={() => setDictionaryOpen((open) => !open)}
              title="Dictionary"
              aria-label="Dictionary"
              aria-expanded={dictionaryOpen}
            >
              <Icon name="search" size={17} />
            </button>
          ) : null}

          {session.sessionRemainingSeconds !== null ? (
            <span className={`exam-timer ${timerTone}`} aria-live="off" title="Time remaining">
              <Icon name="clock" size={15} strokeWidth={2.2} />
              {formatClock(session.sessionRemainingSeconds)}
            </span>
          ) : (
            <span className="exam-timer exam-timer--untimed" title="This attempt has no time limit">
              Untimed
            </span>
          )}

          <Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)} disabled={submitting}>
            Submit
          </Button>
        </div>
      </header>

      {state.integrity.policy.requireFullscreen && !session.isFullscreen ? (
        <div className="exam-banner exam-banner--warning" role="alert">
          <Icon name="alert" size={15} />
          <span>Fullscreen is required in this exam mode. Exits are recorded for your teacher.</span>
          <Button size="sm" onClick={() => void session.requestFullscreen()}>
            Re-enter fullscreen
          </Button>
        </div>
      ) : null}

      {session.warning ? (
        <div className="exam-banner exam-banner--warning" role="alert">
          <Icon name="alert" size={15} />
          <span>{session.warning}</span>
          <Button size="sm" variant="ghost" onClick={session.dismissWarning}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {session.saveStatus === 'offline' ? (
        <div className="exam-banner exam-banner--info" role="status">
          <Icon name="info" size={15} />
          <span>You are offline. Your answers are kept on this device and are sent as soon as the connection returns.</span>
        </div>
      ) : null}

      <div className="exam-toolbar">
        <div className="exam-seg" role="group" aria-label="Layout">
          {viewOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={`exam-seg__btn ${mode === option.mode ? 'is-on' : ''}`}
              aria-pressed={mode === option.mode}
              onClick={() => setView(option.mode)}
              title={option.label}
            >
              <Icon name={option.icon} size={14} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        {sections.length > 1 ? (
          <nav className="exam-parts" aria-label="Test parts" role="tablist">
            {sections.map((section, index) => {
              const progress = sectionProgress.find((row) => row.sectionId === section.id) ?? null;
              const sectionQuestions = questionsBySection.get(section.id) ?? [];
              const answeredInSection = sectionQuestions.filter((question) => answeredNumbers.has(question.number)).length;
              const totalInSection = progress?.totalQuestions ?? sectionQuestions.length;
              const open = isSectionOpen(section.id);
              const current = section.id === activeSection?.id;
              const done = progress?.status === 'COMPLETED';
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  // The part's own skill colour, as a stripe on the chip: in a
                  // full mock the four parts otherwise read as one grey row, and
                  // "which paper am I in?" is the question a candidate asks most.
                  className={[
                    'exam-part',
                    skillClass(section.skill),
                    current ? 'is-current' : '',
                    done ? 'is-done' : '',
                    !open ? 'is-locked' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => switchToSection(section.id)}
                  aria-selected={current}
                  title={open ? section.title || section.label : 'This part is not open yet'}
                >
                  {done ? <Icon name="check" size={13} strokeWidth={2.8} /> : null}
                  {!open ? <Icon name="lock" size={12} /> : null}
                  <span className="exam-part__label">{partLabel(section, index, compact)}</span>
                  <span className="exam-part__count">
                    {section.skill === 'WRITING' || section.writingTasks.length > 0
                      ? answeredInSection === sectionQuestions.length && sectionQuestions.length > 0
                        ? <Icon name="check" size={13} strokeWidth={2.8} />
                        : `${answeredInSection}/${Math.max(sectionQuestions.length, section.writingTasks.length)}`
                      : `${answeredInSection}/${totalInSection}`}
                  </span>
                </button>
              );
            })}
          </nav>
        ) : (
          <span className="exam-toolbar__label">{activeSection?.label}</span>
        )}

        {activeProgress?.status === 'IN_PROGRESS' && activeProgress.remainingSeconds !== null ? (
          <span
            className={`exam-part-timer ${activeProgress.remainingSeconds <= 60 ? 'is-critical' : ''}`}
            title="Time left in this part"
          >
            <Icon name="clock" size={12} strokeWidth={2.4} />
            {formatClock(activeProgress.remainingSeconds)}
          </span>
        ) : null}
      </div>

      <div
        className={`exam-body ${mode === 'SPLIT' ? 'exam-body--split' : 'exam-body--single'}`}
        ref={examBodyRef}
        style={mode === 'SPLIT' ? ({ '--passage-share': `${passageWidth}%` } as CSSProperties) : undefined}
      >
        {showMaterial ? (
          <section className="exam-pane exam-pane--material" aria-label={isWriting ? 'Writing task' : 'Passage and audio'}>
            {isWriting ? (
              <div className="exam-pane__scroll" key={`task-${activeSection?.id}-${activeTaskId}`}>
                {activeTask ? <WritingPrompt item={activeTask} /> : null}
              </div>
            ) : activeSection ? (
              <PassagePane
                key={activeSection.id}
                sections={[activeSection]}
                showInstructions
                lead={
                  <>
                    {activeSection.description ? <p className="exam-lead small muted">{activeSection.description}</p> : null}
                    {activeSection.audio ? (
                      <AudioPlayer
                        audio={activeSection.audio}
                        sectionTitle={activeSection.title || 'Listening part'}
                        onEvent={(type, metadata) => session.logIntegrity(type, metadata)}
                      />
                    ) : null}
                    {activeSection.image ? (
                      <div className="exam-lead">
                        <SectionImage image={activeSection.image} label={activeSection.label} />
                      </div>
                    ) : null}
                  </>
                }
              >
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

        {mode === 'SPLIT' ? (
          <div
            className="exam-divider"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-valuenow={Math.round(passageWidth)}
            aria-label="Resize the two panes (arrow keys)"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const next = Math.min(72, Math.max(26, passageWidth + (event.key === 'ArrowRight' ? 3 : -3)));
              setPassageWidth(next);
              storePassageWidth(next);
            }}
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

        {showWork ? (
          <section className="exam-pane exam-pane--work" aria-label={isWriting ? 'Your answer' : 'Questions'}>
            {isWriting ? (
              <div className="exam-pane__scroll exam-pane__scroll--writing" key={`answer-${activeSection?.id}`}>
                <WritingAnswer
                  tasks={writingTasks}
                  activeTaskId={activeTaskId}
                  onPickTask={setPickedTaskId}
                  answers={state.writing}
                  onSave={(questionId, text) => session.saveWriting(questionId, text)}
                />
              </div>
            ) : (
              <div className="exam-pane__scroll" key={`questions-${activeSection?.id}`}>
                {activeSection?.groups.map((group) =>
                  group.type === 'WRITING_TASK_1' || group.type === 'WRITING_TASK_2' ? null : (
                    <div className="question-block" key={group.id} id={`group-${group.id}`}>
                      <QuestionGroupHeader group={group} onJump={() => group.rangeFrom && jumpToQuestion(group.rangeFrom)} />
                      <div className="question-group">
                        <GroupOptionBank options={group.sharedOptions} numbering={group.config.optionNumbering} />
                        <div className="question-group__body">
                          {group.questions.map((question) => (
                            <QuestionRenderer
                              key={question.id}
                              group={group}
                              question={question}
                              response={state.answers[question.id] ?? null}
                              flagged={state.flagged.includes(question.id)}
                              active={currentQuestionId === question.id}
                              onAnswer={(questionId, response) => session.setAnswer(questionId, response)}
                              onToggleFlag={(questionId) => session.toggleFlag(questionId)}
                              onFocusQuestion={setCurrentQuestionId}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
        ) : null}
      </div>

      {allQuestions.length > 0 ? (
        <nav className="exam-bottombar" aria-label="Question navigation">
          <button
            type="button"
            className="exam-palette"
            onClick={() => setDrawerOpen(true)}
            title="Question palette"
            aria-label={`Question palette: ${answeredTotal} of ${total} answered`}
          >
            <Icon name="grid" size={16} />
            <span className="exam-palette__count">
              <strong>{answeredTotal}</strong>/{total}
            </span>
            <span className="exam-palette__label">answered</span>
          </button>

          <span
            className="exam-bottombar__meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredTotal}
            aria-label="Questions answered"
          >
            <span style={{ width: `${total === 0 ? 0 : Math.round((answeredTotal / total) * 100)}%` }} />
          </span>

          <div className="exam-bottombar__nav">
            <Button
              size="sm"
              onClick={() => (isWriting ? stepPart(-1) : stepQuestion(-1))}
              disabled={isWriting ? activeIndex <= 0 : false}
              aria-label={isWriting ? 'Previous part' : 'Previous question'}
            >
              <Icon name="chevronRight" size={14} className="icon--flip" />
              <span>Prev</span>
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
                  try {
                    await session.completeSection(activeSection?.id);
                  } catch (completeError) {
                    toast.push(completeError instanceof Error ? completeError.message : 'Could not continue.', 'error');
                  }
                  setAdvancedToNext(false);
                }}
              >
                <span>{advancedToNext ? 'Confirm' : compact ? 'Next part' : `Continue to ${nextClosedSection.label}`}</span>
                <Icon name="chevronRight" size={14} />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => (isWriting ? stepPart(1) : stepQuestion(1))}
                disabled={isWriting ? activeIndex >= sections.length - 1 : false}
                aria-label={isWriting ? 'Next part' : 'Next question'}
              >
                <span>Next</span>
                <Icon name="chevronRight" size={14} />
              </Button>
            )}
          </div>
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
            <Button variant="primary" loading={leaving} onClick={() => void leaveTest()}>
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
          setDrawerOpen(false);
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
          You have answered <strong>{answeredTotal}</strong> of <strong>{total}</strong> {isWriting ? 'tasks' : 'questions'}.
          {unansweredCount > 0 ? (
            <>
              {' '}
              <strong>{unansweredCount}</strong> {isWriting ? 'task' : 'question'}
              {unansweredCount === 1 ? ' is' : 's are'} still unanswered.
            </>
          ) : null}
        </p>
        <p className="muted small">
          Answers lock after submission. Reading and Listening are marked straight away. Writing is marked
          automatically by two AI judges as soon as you submit.
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

      {dictionaryOpen ? <ExamDictionary onClose={() => setDictionaryOpen(false)} /> : null}

      {session.tabLock ? (
        <TabLockOverlay lock={session.tabLock} onReturn={session.acknowledgeTabLock} onViewResults={onFinished} />
      ) : null}
    </div>
  );
}

/**
 * Brings a question into view by scrolling its own pane, never the document,
 * and focuses its control without letting the browser scroll anything else.
 */
function scrollQuestionIntoView(number: number): void {
  const element = document.getElementById(`q-${number}`);
  if (!element) return;
  const scroller = element.closest<HTMLElement>('.exam-pane__scroll');
  if (scroller) {
    const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const smooth = document.documentElement.dataset.reduceMotion !== 'true';
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset - 12), behavior: smooth ? 'smooth' : 'auto' });
  }
  element.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
}

/** "Passage 1" -> "P1", "Task 2" -> "T2" on a phone; the full label elsewhere. */
function partLabel(section: CandidateSection, index: number, compact: boolean): string {
  const label = (section.label || section.title || `Part ${index + 1}`).trim();
  if (!compact) return label;
  const match = /([A-Za-z])[A-Za-z]*\s*(\d+)\s*$/.exec(label);
  return match ? `${match[1]!.toUpperCase()}${match[2]}` : label.slice(0, 8);
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
  // Side by side on anything wide enough. Phones in portrait ignore this: they
  // get a Passage | Questions switch instead (see `compact` in ExamShell).
  return 'SPLIT';
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
