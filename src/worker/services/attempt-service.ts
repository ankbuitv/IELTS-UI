import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import type { AuthUser } from '../lib/auth-types';
import { markAttempt, type SessionMarkResult } from './marking-service';
import { assertPracticeAccess } from './access-code-service';
import { loadCandidateTest, type CandidateTestPayload } from './content-service';
import {
  resolvePolicy,
  type IntegrityEventType,
  type IntegrityPolicy,
  EVENT_SEVERITY,
} from '../../shared/integrity';
import { isCountedEvent } from '../../shared/integrity';
import type { CandidateResponse } from '../../shared/answer-key';
import { countWords } from '../../shared/answer-key';
import { isQuestionType } from '../../shared/question-types';
import type { ExamMode, ResultVisibility, Skill, TestType } from '../../shared/types';
import { loadPlatformSettings } from '../lib/settings';

const TRANSITION_GRACE_SECONDS = 60;

export interface AttemptRow {
  id: string;
  user_id: string;
  assignment_id: string | null;
  test_id: string;
  test_version_id: string;
  test_type: TestType;
  mode: ExamMode;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'ABANDONED';
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
  submitted_reason: string | null;
  current_component_index: number;
  integrity_policy_json: string;
  result_visibility: ResultVisibility;
  scoring_profile_id: string | null;
  raw_score: number | null;
  total_questions: number | null;
  estimated_band: number | null;
  marked_at: string | null;
}

export interface SkillSessionRow {
  id: string;
  attempt_id: string;
  component_index: number;
  skill: Skill;
  test_version_id: string;
  label: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  duration_seconds: number | null;
  raw_score: number | null;
  total_questions: number | null;
  estimated_band: number | null;
  scoring_profile_id: string | null;
  scoring_profile_version: number | null;
}

interface AssignmentRow {
  id: string;
  classroom_id: string;
  teacher_id: string;
  test_id: string;
  test_version_id: string;
  title: string;
  start_at: string | null;
  deadline_at: string | null;
  max_attempts: number;
  timing_policy: 'EXAM_DURATION' | 'UNTIMED' | 'CUSTOM';
  custom_duration_seconds: number | null;
  mode: ExamMode;
  integrity_policy_json: string;
  result_visibility: ResultVisibility;
  allow_reattempt: number;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
}

// -----------------------------------------------------------------------------
// Attempt creation
// -----------------------------------------------------------------------------
export interface CreateAttemptInput {
  testId?: string;
  testVersionId?: string;
  assignmentId?: string;
  /** Supplied when starting a code-protected test for the first time. */
  accessCode?: string;
  mode?: ExamMode;
  clientMeta?: Record<string, unknown>;
}

export interface CreateAttemptResult {
  attemptId: string;
  mode: ExamMode;
  integrityPolicy: IntegrityPolicy;
}

export async function createAttempt(
  env: Env,
  user: AuthUser,
  input: CreateAttemptInput,
): Promise<CreateAttemptResult> {
  let assignment: AssignmentRow | null = null;
  if (input.assignmentId) {
    assignment = await requireAssignmentAccess(env, user, input.assignmentId);
  }

  let versionId = input.testVersionId ?? assignment?.test_version_id ?? null;
  let testId = input.testId ?? assignment?.test_id ?? null;

  const version = versionId
    ? await env.DB.prepare('SELECT * FROM test_versions WHERE id = ?').bind(versionId).first<{
        id: string;
        test_id: string;
        status: string;
        duration_seconds: number | null;
        config_json: string;
        scoring_profile_id: string | null;
      }>()
    : testId
      ? await loadCurrentVersion(env, testId)
      : null;

  if (!version) throw ApiError.notFound('Test not found.');
  versionId = version.id;
  testId = version.test_id;

  if (!assignment && version.status !== 'PUBLISHED') {
    throw ApiError.forbidden('This test is not available for practice yet.');
  }
  if (assignment && version.status === 'DRAFT') {
    throw ApiError.forbidden('The assigned test version is not published yet.');
  }

  const test = await env.DB.prepare('SELECT id, title, type, status FROM tests WHERE id = ?')
    .bind(testId)
    .first<{ id: string; title: string; type: TestType; status: string }>();
  if (!test) throw ApiError.notFound('Test not found.');

  const versionConfig = parseJson<{ defaultMode?: ExamMode; defaultResultVisibility?: ResultVisibility; skillConfig?: Record<string, { durationSeconds?: number }> }>(
    version.config_json,
    {},
  );

  if (assignment) {
    assertAttemptWindow(assignment);
    const attemptCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM attempts WHERE user_id = ? AND assignment_id = ? AND status != 'ABANDONED'`,
    )
      .bind(user.id, assignment.id)
      .first<{ count: number }>();
    const used = attemptCount?.count ?? 0;
    if (used >= Math.max(1, assignment.max_attempts)) {
      throw ApiError.conflict('You have used all the attempts allowed for this assignment.');
    }
    // Reuse an in-progress attempt rather than silently creating a parallel one.
    const existing = await env.DB.prepare(
      `SELECT id, mode, integrity_policy_json FROM attempts
        WHERE user_id = ? AND assignment_id = ? AND status = 'IN_PROGRESS'
        ORDER BY started_at DESC LIMIT 1`,
    )
      .bind(user.id, assignment.id)
      .first<{ id: string; mode: ExamMode; integrity_policy_json: string }>();
    if (existing) {
      return {
        attemptId: existing.id,
        mode: existing.mode,
        integrityPolicy: resolvePolicy(existing.mode, parseJson<Partial<IntegrityPolicy>>(existing.integrity_policy_json, {})),
      };
    }
  } else {
    const inProgress = await env.DB.prepare(
      `SELECT id, mode, integrity_policy_json FROM attempts
        WHERE user_id = ? AND test_version_id = ? AND status = 'IN_PROGRESS'
        ORDER BY started_at DESC LIMIT 1`,
    )
      .bind(user.id, versionId)
      .first<{ id: string; mode: ExamMode; integrity_policy_json: string }>();
    if (inProgress) {
      return {
        attemptId: inProgress.id,
        mode: inProgress.mode,
        integrityPolicy: resolvePolicy(
          inProgress.mode,
          parseJson<Partial<IntegrityPolicy>>(inProgress.integrity_policy_json, {}),
        ),
      };
    }
  }

  // Code-protected tests: students unlock with the code (once ever) before a new
  // practice attempt is created. Assignment attempts bypass — the teacher's
  // assignment is itself the authorisation — and resuming an in-progress
  // attempt above never re-checks, so a rotation cannot strand a live exam.
  if (!assignment) {
    await assertPracticeAccess(env, user, testId, input.accessCode);
  }

  const mode: ExamMode = assignment?.mode ?? input.mode ?? versionConfig.defaultMode ?? 'PRACTICE';
  const policyOverrides = assignment
    ? parseJson<Partial<IntegrityPolicy>>(assignment.integrity_policy_json, {})
    : {};
  const policy = resolvePolicy(mode, policyOverrides);

  const resultVisibility: ResultVisibility =
    assignment?.result_visibility ?? versionConfig.defaultResultVisibility ?? 'IMMEDIATE';

  const startedAt = nowIso();

  // Build the component plan: one session per skill, or one per mock component.
  const plan = await buildComponentPlan(env, test.type, versionId, version.duration_seconds, versionConfig, assignment);

  const attemptId = newId('att');
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO attempts (id, user_id, assignment_id, test_id, test_version_id, test_type, mode, status, started_at,
                             deadline_at, current_component_index, integrity_policy_json, result_visibility,
                             scoring_profile_id, client_meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      attemptId,
      user.id,
      assignment?.id ?? null,
      testId,
      versionId,
      test.type,
      mode,
      startedAt,
      null,
      JSON.stringify(policy),
      resultVisibility,
      version.scoring_profile_id,
      JSON.stringify(input.clientMeta ?? {}),
      startedAt,
      startedAt,
    ),
  ];

  plan.components.forEach((component, index) => {
    const isFirst = index === 0;
    statements.push(
      env.DB.prepare(
        `INSERT INTO attempt_skill_sessions (id, attempt_id, component_index, skill, test_version_id, label, status,
                                             started_at, deadline_at, duration_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId('ses'),
        attemptId,
        index,
        component.skill,
        component.testVersionId,
        component.label,
        isFirst ? 'IN_PROGRESS' : 'NOT_STARTED',
        isFirst ? startedAt : null,
        isFirst && component.durationSeconds ? addSeconds(startedAt, component.durationSeconds) : null,
        component.durationSeconds,
        startedAt,
        startedAt,
      ),
    );
  });

  const totalPlannedSeconds = plan.components.reduce(
    (total, component) => total + (component.durationSeconds ?? 0) + component.breakAfterSeconds,
    0,
  );
  const overallDeadline = plan.timed ? addSeconds(startedAt, totalPlannedSeconds + TRANSITION_GRACE_SECONDS) : null;
  statements.push(
    env.DB.prepare('UPDATE attempts SET deadline_at = ? WHERE id = ?').bind(overallDeadline, attemptId),
  );

  await env.DB.batch(statements);

  await recordIntegrityEvents(env, attemptId, [
    { type: 'SESSION_START', occurredAt: startedAt, metadata: { mode, testType: test.type } },
  ]);

  return { attemptId, mode, integrityPolicy: policy };
}

function assertAttemptWindow(assignment: AssignmentRow): void {
  const now = Date.now();
  if (assignment.status === 'DRAFT') throw ApiError.forbidden('The assignment is not open yet.');
  if (assignment.status === 'CLOSED' || assignment.status === 'ARCHIVED') {
    throw ApiError.forbidden('This assignment is closed.');
  }
  if (assignment.start_at && new Date(assignment.start_at).getTime() > now) {
    throw ApiError.forbidden('This assignment has not opened yet.');
  }
  if (assignment.deadline_at && new Date(assignment.deadline_at).getTime() < now) {
    throw ApiError.forbidden('The deadline for this assignment has passed.');
  }
}

async function loadCurrentVersion(env: Env, testId: string) {
  const test = await env.DB.prepare('SELECT current_version_id FROM tests WHERE id = ?').bind(testId).first<{
    current_version_id: string | null;
  }>();
  if (!test?.current_version_id) return null;
  return env.DB.prepare('SELECT * FROM test_versions WHERE id = ?').bind(test.current_version_id).first<{
    id: string;
    test_id: string;
    status: string;
    duration_seconds: number | null;
    config_json: string;
    scoring_profile_id: string | null;
  }>();
}

interface ComponentPlan {
  timed: boolean;
  components: Array<{
    skill: Skill;
    testVersionId: string;
    label: string;
    durationSeconds: number | null;
    breakAfterSeconds: number;
  }>;
}

async function buildComponentPlan(
  env: Env,
  testType: TestType,
  versionId: string,
  versionDuration: number | null,
  versionConfig: { skillConfig?: Record<string, { durationSeconds?: number }> },
  assignment: AssignmentRow | null,
): Promise<ComponentPlan> {
  const resolveDuration = (skill: Skill, fallback: number | null): number | null => {
    if (assignment?.timing_policy === 'UNTIMED') return null;
    if (assignment?.timing_policy === 'CUSTOM') return assignment.custom_duration_seconds ?? fallback;
    const override = versionConfig.skillConfig?.[skill]?.durationSeconds;
    return override ?? fallback;
  };

  if (testType !== 'FULL_MOCK') {
    const skill = testType as Skill; // caller guarantees this path is a single-skill test
    return {
      timed: assignment?.timing_policy !== 'UNTIMED',
      components: [
        {
          skill,
          testVersionId: versionId,
          label: skill,
          durationSeconds: resolveDuration(skill, versionDuration),
          breakAfterSeconds: 0,
        },
      ],
    };
  }

  const components = await env.DB.prepare(
    `SELECT c.skill, c.test_version_id, c.label, c.duration_seconds, c.break_after_seconds, v.duration_seconds AS version_duration
       FROM mock_components c
       JOIN test_versions v ON v.id = c.test_version_id
      WHERE c.mock_version_id = ?
      ORDER BY c.order_index`,
  )
    .bind(versionId)
    .all<{
      skill: Skill;
      test_version_id: string;
      label: string;
      duration_seconds: number;
      break_after_seconds: number;
      version_duration: number | null;
    }>();

  if (components.results.length === 0) {
    throw ApiError.conflict('This full mock has no components configured.');
  }

  return {
    timed: assignment?.timing_policy !== 'UNTIMED',
    components: components.results.map((component) => ({
      skill: component.skill,
      testVersionId: component.test_version_id,
      label: component.label || `${component.skill} ${component.test_version_id.slice(-4)}`,
      durationSeconds: resolveDuration(component.skill, component.duration_seconds || component.version_duration),
      breakAfterSeconds: component.break_after_seconds ?? 0,
    })),
  };
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

// -----------------------------------------------------------------------------
// Authorization helpers
// -----------------------------------------------------------------------------
export async function requireAssignmentAccess(env: Env, user: AuthUser, assignmentId: string): Promise<AssignmentRow> {
  const assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(assignmentId)
    .first<AssignmentRow>();
  if (!assignment) throw ApiError.notFound('Assignment not found.');

  if (user.role === 'ADMIN') return assignment;
  if (user.role === 'TEACHER' && assignment.teacher_id === user.id) return assignment;

  const membership = await env.DB.prepare(
    `SELECT id FROM classroom_members WHERE classroom_id = ? AND user_id = ? AND status = 'ACTIVE'`,
  )
    .bind(assignment.classroom_id, user.id)
    .first<{ id: string }>();
  if (!membership) throw ApiError.forbidden('This assignment is not available to you.');
  return assignment;
}

export async function requireOwnedAttempt(env: Env, user: AuthUser, attemptId: string): Promise<AttemptRow> {
  const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?').bind(attemptId).first<AttemptRow>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  if (attempt.user_id !== user.id && user.role !== 'ADMIN') {
    // Teachers get a separate, read-only reporting serializer.
    const allowed = user.role === 'TEACHER' && (await teacherCanReadAttempt(env, user, attempt));
    if (!allowed) throw ApiError.forbidden('This attempt is not available to you.');
  }
  return attempt;
}

async function teacherCanReadAttempt(env: Env, user: AuthUser, attempt: AttemptRow): Promise<boolean> {
  if (attempt.assignment_id) {
    const assignment = await env.DB.prepare('SELECT teacher_id FROM assignments WHERE id = ?')
      .bind(attempt.assignment_id)
      .first<{ teacher_id: string }>();
    if (assignment?.teacher_id === user.id) return true;
  }
  const shared = await env.DB.prepare(
    `SELECT 1 AS ok
       FROM classroom_members tm
       JOIN classroom_members sm ON sm.classroom_id = tm.classroom_id AND sm.status = 'ACTIVE'
      WHERE tm.user_id = ? AND sm.user_id = ? AND tm.status = 'ACTIVE'
      LIMIT 1`,
  )
    .bind(user.id, attempt.user_id)
    .first<{ ok: number }>();
  return Boolean(shared);
}

// -----------------------------------------------------------------------------
// Time enforcement (server-authoritative)
// -----------------------------------------------------------------------------
export interface TimeState {
  serverNow: string;
  attemptDeadline: string | null;
  attemptRemainingSeconds: number | null;
  activeSessionId: string | null;
  sessionRemainingSeconds: number | null;
  sessionDeadline: string | null;
  autoSubmitted: boolean;
}

/**
 * Recomputes deadlines from server timestamps on every read. Refreshing the
 * page, changing the device clock or reconnecting therefore cannot create time.
 */
export async function enforceTime(env: Env, attempt: AttemptRow): Promise<TimeState> {
  const now = nowIso();
  if (attempt.status !== 'IN_PROGRESS') {
    return {
      serverNow: now,
      attemptDeadline: attempt.deadline_at,
      attemptRemainingSeconds: null,
      activeSessionId: null,
      sessionRemainingSeconds: null,
      sessionDeadline: null,
      autoSubmitted: false,
    };
  }

  if (attempt.deadline_at && new Date(attempt.deadline_at).getTime() <= Date.now()) {
    await finalizeAttempt(env, attempt, 'TIMEOUT');
    return {
      serverNow: now,
      attemptDeadline: attempt.deadline_at,
      attemptRemainingSeconds: 0,
      activeSessionId: null,
      sessionRemainingSeconds: 0,
      sessionDeadline: null,
      autoSubmitted: true,
    };
  }

  const sessions = await env.DB.prepare(
    'SELECT * FROM attempt_skill_sessions WHERE attempt_id = ? ORDER BY component_index',
  )
    .bind(attempt.id)
    .all<SkillSessionRow>();

  const active = sessions.results.find((session) => session.component_index === attempt.current_component_index) ?? null;
  let sessionRemaining: number | null = null;

  if (active && active.status === 'IN_PROGRESS' && active.deadline_at) {
    const remainingMs = new Date(active.deadline_at).getTime() - Date.now();
    sessionRemaining = Math.max(0, Math.floor(remainingMs / 1000));
    if (remainingMs <= 0) {
      await env.DB.prepare(
        `UPDATE attempt_skill_sessions SET status = 'EXPIRED', submitted_at = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(now, now, active.id)
        .run();

      const isLast = active.component_index >= sessions.results.length - 1;
      if (isLast) {
        await finalizeAttempt(env, attempt, 'TIMEOUT');
        return {
          serverNow: now,
          attemptDeadline: attempt.deadline_at,
          attemptRemainingSeconds: remainingSeconds(attempt.deadline_at),
          activeSessionId: active.id,
          sessionRemainingSeconds: 0,
          sessionDeadline: active.deadline_at,
          autoSubmitted: true,
        };
      }
      // Multi-section mock: the finished section closes and the candidate
      // continues when ready; the overall attempt deadline still caps total time.
      sessionRemaining = 0;
    }
  }

  return {
    serverNow: now,
    attemptDeadline: attempt.deadline_at,
    attemptRemainingSeconds: remainingSeconds(attempt.deadline_at),
    activeSessionId: active?.id ?? null,
    sessionRemainingSeconds: sessionRemaining,
    sessionDeadline: active?.deadline_at ?? null,
    autoSubmitted: false,
  };
}

function remainingSeconds(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000));
}

// -----------------------------------------------------------------------------
// Candidate state
// -----------------------------------------------------------------------------
export interface CandidateAttemptState {
  attemptId: string;
  testId: string;
  testTitle: string;
  testType: TestType;
  testVersionId: string;
  versionNumber: number;
  mode: ExamMode;
  status: AttemptRow['status'];
  resultVisibility: ResultVisibility;
  assignmentId: string | null;
  startedAt: string;
  serverNow: string;
  remainingSeconds: number | null;
  time: TimeState;
  components: Array<{
    componentIndex: number;
    sessionId: string;
    skill: Skill;
    label: string;
    status: SkillSessionRow['status'];
    testVersionId: string;
    durationSeconds: number | null;
    breakAfterSeconds: number;
    startedAt: string | null;
    deadlineAt: string | null;
    remainingSeconds: number | null;
  }>;
  activeComponentIndex: number;
  content: CandidateTestPayload | null;
  answers: Record<string, CandidateResponse>;
  flagged: string[];
  answeredCount: number;
  totalQuestions: number;
  writing: Array<{ questionId: string; text: string; wordCount: number }>;
  integrity: {
    policy: IntegrityPolicy;
    counted: number;
    tabAway: number;
    fullscreenExits: number;
    warningLevel: 'NONE' | 'WARNING' | 'CRITICAL';
    /** Candidate-facing integrity statement, configurable in platform settings. */
    notice: string;
  };
  submitted: boolean;
}

export async function loadCandidateAttemptState(
  env: Env,
  user: AuthUser,
  attemptId: string,
): Promise<CandidateAttemptState> {
  const settings = await loadPlatformSettings(env);
  const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?').bind(attemptId).first<AttemptRow>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');

  const time = await enforceTime(env, attempt);
  const refreshed = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?').bind(attemptId).first<AttemptRow>();
  const current = refreshed ?? attempt;

  const [test, version, sessions, answers, writing, integrity] = await Promise.all([
    env.DB.prepare('SELECT title FROM tests WHERE id = ?').bind(current.test_id).first<{ title: string }>(),
    env.DB.prepare('SELECT version_number FROM test_versions WHERE id = ?')
      .bind(current.test_version_id)
      .first<{ version_number: number }>(),
    env.DB.prepare('SELECT * FROM attempt_skill_sessions WHERE attempt_id = ? ORDER BY component_index')
      .bind(attemptId)
      .all<SkillSessionRow>(),
    env.DB.prepare('SELECT question_id, answer_json, is_flagged FROM attempt_answers WHERE attempt_id = ?')
      .bind(attemptId)
      .all<{ question_id: string; answer_json: string | null; is_flagged: number }>(),
    env.DB.prepare(
      'SELECT question_id, response_text, word_count FROM writing_submissions WHERE attempt_id = ? ORDER BY created_at',
    )
      .bind(attemptId)
      .all<{ question_id: string; response_text: string; word_count: number }>(),
    env.DB.prepare('SELECT type FROM integrity_events WHERE attempt_id = ?')
      .bind(attemptId)
      .all<{ type: string }>(),
  ]);

  const activeSession = sessions.results.find((s) => s.component_index === current.current_component_index) ?? null;
  let content: CandidateTestPayload | null = null;
  if (activeSession && current.status === 'IN_PROGRESS') {
    const loaded = await loadCandidateTest(env, activeSession.test_version_id);
    content = loaded.payload;
  }

  const answerMap: Record<string, CandidateResponse> = {};
  const flagged: string[] = [];
  for (const row of answers.results) {
    if (row.answer_json) {
      const parsed = parseJson<CandidateResponse | null>(row.answer_json, null);
      if (parsed) answerMap[row.question_id] = parsed;
    }
    if (row.is_flagged === 1) flagged.push(row.question_id);
  }

  const counts = countIntegrity(integrity.results.map((row) => row.type));
  const policy = resolvePolicy(current.mode, parseJson<Partial<IntegrityPolicy>>(current.integrity_policy_json, {}));

  const totalQuestions = content
    ? content.sections
        .flatMap((section) => section.groups.flatMap((group) => group.questions))
        .filter((question) => !isWritingTaskNumber(content, question.number)).length
    : (current.total_questions ?? 0);

  const answeredIds = new Set(
    Object.entries(answerMap)
      .filter(([, value]) => isNonEmptyResponse(value))
      .map(([questionId]) => questionId),
  );
  const writingAnswered = writing.results.filter((row) => row.response_text.trim().length > 0);
  for (const row of writingAnswered) answeredIds.add(row.question_id);

  const breakByIndex = new Map<number, number>();
  if (current.test_type === 'FULL_MOCK') {
    const mockComponents = await env.DB.prepare(
      'SELECT order_index, break_after_seconds FROM mock_components WHERE mock_version_id = ? ORDER BY order_index',
    )
      .bind(current.test_version_id)
      .all<{ order_index: number; break_after_seconds: number }>();
    for (const component of mockComponents.results) {
      breakByIndex.set(component.order_index, component.break_after_seconds ?? 0);
    }
  }

  return {
    attemptId: current.id,
    testId: current.test_id,
    testTitle: test?.title ?? 'Test',
    testType: current.test_type,
    testVersionId: current.test_version_id,
    versionNumber: version?.version_number ?? 1,
    mode: current.mode,
    status: current.status,
    resultVisibility: current.result_visibility,
    assignmentId: current.assignment_id,
    startedAt: current.started_at,
    serverNow: time.serverNow,
    remainingSeconds: time.attemptRemainingSeconds,
    time,
    components: sessions.results.map((session) => ({
      componentIndex: session.component_index,
      sessionId: session.id,
      skill: session.skill,
      label: session.label,
      status: session.status,
      testVersionId: session.test_version_id,
      durationSeconds: session.duration_seconds,
      breakAfterSeconds: breakByIndex.get(session.component_index) ?? 0,
      startedAt: session.started_at,
      deadlineAt: session.deadline_at,
      remainingSeconds: remainingSeconds(session.deadline_at),
    })),
    activeComponentIndex: current.current_component_index,
    content,
    answers: answerMap,
    flagged,
    answeredCount: answeredIds.size,
    totalQuestions,
    writing: writing.results.map((row) => ({
      questionId: row.question_id,
      text: row.response_text,
      wordCount: row.word_count,
    })),
    integrity: {
      policy,
      counted: counts.counted,
      tabAway: counts.tabAway,
      fullscreenExits: counts.fullscreenExits,
      warningLevel: warningLevel(policy, counts.counted),
      notice: settings.integrityNotice,
    },
    submitted: current.status !== 'IN_PROGRESS',
  };
}

function isWritingTaskNumber(content: CandidateTestPayload, number: number): boolean {
  const writingNumbers = new Set(
    content.sections.flatMap((section) => section.writingTasks.map((task) => task.number)),
  );
  return writingNumbers.has(number);
}

function isNonEmptyResponse(response: CandidateResponse): boolean {
  if ('values' in response) return response.values.some((value) => String(value ?? '').trim().length > 0);
  if ('value' in response) return String(response.value ?? '').trim().length > 0;
  return false;
}

function warningLevel(policy: IntegrityPolicy, counted: number): 'NONE' | 'WARNING' | 'CRITICAL' {
  if (policy.autoSubmitAtEvents !== null && counted >= policy.autoSubmitAtEvents) return 'CRITICAL';
  if (policy.warnAtEvents !== null && counted >= policy.warnAtEvents) return 'WARNING';
  return 'NONE';
}

// -----------------------------------------------------------------------------
// Answer persistence
// -----------------------------------------------------------------------------
export interface AnswerUpdate {
  questionId: string;
  response: CandidateResponse | null;
  flagged?: boolean;
}

export async function saveAnswers(
  env: Env,
  user: AuthUser,
  attemptId: string,
  updates: AnswerUpdate[],
): Promise<{ saved: number; answeredCount: number }> {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');
  if (attempt.status !== 'IN_PROGRESS') {
    throw new ApiError('ATTEMPT_LOCKED', 'This attempt has been submitted and answers can no longer change.');
  }

  await enforceTime(env, attempt);

  const sessions = await env.DB.prepare(
    'SELECT * FROM attempt_skill_sessions WHERE attempt_id = ? ORDER BY component_index',
  )
    .bind(attemptId)
    .all<SkillSessionRow>();
  const active = sessions.results.find((s) => s.component_index === attempt.current_component_index) ?? null;
  if (!active) throw ApiError.conflict('This attempt has no active section.');
  if (active.status !== 'IN_PROGRESS') {
    const deadlinePassed = active.deadline_at && new Date(active.deadline_at).getTime() <= Date.now();
    throw new ApiError(
      deadlinePassed ? 'ATTEMPT_EXPIRED' : 'ATTEMPT_LOCKED',
      deadlinePassed
        ? 'The time allowed for this section has ended.'
        : 'This section has already been submitted.',
    );
  }

  const validQuestions = await env.DB.prepare(
    `SELECT q.id FROM questions q
       JOIN question_groups g ON g.id = q.question_group_id
      WHERE q.test_version_id = ? AND g.question_type NOT IN ('WRITING_TASK_1','WRITING_TASK_2')`,
  )
    .bind(active.test_version_id)
    .all<{ id: string }>();
  const validIds = new Set(validQuestions.results.map((row) => row.id));

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  let saved = 0;

  for (const update of updates) {
    if (!validIds.has(update.questionId)) {
      throw ApiError.validation('One of the submitted questions does not belong to this attempt.');
    }
    const answered = update.response ? isNonEmptyResponse(update.response) : false;
    statements.push(
      env.DB.prepare(
        `INSERT INTO attempt_answers (id, attempt_id, skill_session_id, question_id, test_version_id, answer_json,
                                      is_flagged, answered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET answer_json = excluded.answer_json,
                       is_flagged = excluded.is_flagged,
                       answered_at = COALESCE(excluded.answered_at, attempt_answers.answered_at),
                       updated_at = excluded.updated_at`,
      ).bind(
        `ans_${attemptId}_${update.questionId}`,
        attemptId,
        active.id,
        update.questionId,
        active.test_version_id,
        update.response && answered ? JSON.stringify(update.response) : null,
        update.flagged ? 1 : 0,
        answered ? timestamp : null,
        timestamp,
      ),
    );
    saved += 1;
  }

  if (statements.length > 0) await env.DB.batch(statements);

  const answered = await countAnswered(env, attemptId);
  await env.DB.prepare('UPDATE attempts SET updated_at = ? WHERE id = ?').bind(timestamp, attemptId).run();

  return { saved, answeredCount: answered };
}

async function countAnswered(env: Env, attemptId: string): Promise<number> {
  const answers = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM attempt_answers
      WHERE attempt_id = ? AND answer_json IS NOT NULL AND answer_json != '' AND answer_json != 'null'`,
  )
    .bind(attemptId)
    .first<{ count: number }>();
  const writing = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM writing_submissions WHERE attempt_id = ? AND TRIM(response_text) != ''`,
  )
    .bind(attemptId)
    .first<{ count: number }>();
  return (answers?.count ?? 0) + (writing?.count ?? 0);
}

export async function saveWritingResponse(
  env: Env,
  user: AuthUser,
  attemptId: string,
  questionId: string,
  text: string,
): Promise<{ wordCount: number }> {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');
  if (attempt.status !== 'IN_PROGRESS') {
    throw new ApiError('ATTEMPT_LOCKED', 'This attempt has been submitted and responses can no longer change.');
  }
  await enforceTime(env, attempt);

  const question = await env.DB.prepare(
    `SELECT q.id, q.number, q.prompt, q.test_version_id, g.question_type, s.id AS session_id, s.status AS session_status,
            s.deadline_at, s.component_index
       FROM questions q
       JOIN question_groups g ON g.id = q.question_group_id
       JOIN attempt_skill_sessions s ON s.test_version_id = q.test_version_id AND s.attempt_id = ?
      WHERE q.id = ? AND g.question_type IN ('WRITING_TASK_1', 'WRITING_TASK_2')`,
  )
    .bind(attemptId, questionId)
    .first<{
      id: string;
      number: number;
      prompt: string;
      test_version_id: string;
      question_type: string;
      session_id: string;
      session_status: string;
      deadline_at: string | null;
      component_index: number;
    }>();

  if (!question) throw ApiError.notFound('Writing task not found for this attempt.');
  if (question.component_index !== attempt.current_component_index) {
    throw ApiError.conflict('That writing task belongs to a section that is no longer active.');
  }
  if (question.session_status !== 'IN_PROGRESS') {
    throw new ApiError('ATTEMPT_LOCKED', 'This writing section has already ended.');
  }
  if (question.deadline_at && new Date(question.deadline_at).getTime() <= Date.now()) {
    throw new ApiError('ATTEMPT_EXPIRED', 'The time allowed for this section has ended.');
  }

  const trimmed = text.slice(0, 40_000);
  const wordCount = countWords(trimmed);
  const timestamp = nowIso();

  await env.DB.prepare(
    `INSERT INTO writing_submissions (id, attempt_id, skill_session_id, question_id, test_version_id, task_label,
                                      prompt_snapshot, response_text, word_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET response_text = excluded.response_text, word_count = excluded.word_count, updated_at = excluded.updated_at`,
  )
    .bind(
      `wrt_${attemptId}_${questionId}`,
      attemptId,
      question.session_id,
      questionId,
      question.test_version_id,
      question.question_type === 'WRITING_TASK_1' ? 'Task 1' : 'Task 2',
      question.prompt.slice(0, 4000),
      trimmed,
      wordCount,
      timestamp,
      timestamp,
    )
    .run();

  return { wordCount };
}

// -----------------------------------------------------------------------------
// Integrity events
// -----------------------------------------------------------------------------
export interface IntegrityEventInput {
  type: IntegrityEventType;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
  clientSeq?: number;
}

export async function recordIntegrityEvents(
  env: Env,
  attemptId: string,
  events: IntegrityEventInput[],
  context: { userAgent?: string; sessionId?: string | null } = {},
): Promise<{ recorded: number }> {
  if (events.length === 0) return { recorded: 0 };
  const timestamp = nowIso();
  const statements = events.slice(0, 100).map((event) =>
    env.DB.prepare(
      `INSERT INTO integrity_events (id, attempt_id, skill_session_id, type, severity, occurred_at, recorded_at,
                                     client_seq, metadata_json, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId('int'),
      attemptId,
      context.sessionId ?? null,
      event.type,
      EVENT_SEVERITY[event.type] ?? 'INFO',
      typeof event.occurredAt === 'string' && !Number.isNaN(Date.parse(event.occurredAt))
        ? event.occurredAt
        : timestamp,
      timestamp,
      event.clientSeq ?? null,
      JSON.stringify(event.metadata ?? {}).slice(0, 4000),
      context.userAgent?.slice(0, 400) ?? null,
    ),
  );
  await env.DB.batch(statements);
  return { recorded: events.length };
}

/**
 * Applies the policy thresholds. A single Alt+Tab fires both WINDOW_BLUR and
 * TAB_HIDDEN; only TAB_HIDDEN and FULLSCREEN_EXIT count towards thresholds so a
 * candidate is not penalised twice for one action.
 */
export async function applyIntegrityPolicy(
  env: Env,
  user: AuthUser,
  attemptId: string,
  events: IntegrityEventInput[],
  context: { userAgent?: string } = {},
): Promise<{ recorded: number; counted: number; warningLevel: 'NONE' | 'WARNING' | 'CRITICAL'; autoSubmitted: boolean }> {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');
  if (attempt.status !== 'IN_PROGRESS') {
    return { recorded: 0, counted: 0, warningLevel: 'NONE', autoSubmitted: false };
  }

  const activeSession = await env.DB.prepare(
    'SELECT id FROM attempt_skill_sessions WHERE attempt_id = ? AND component_index = ?',
  )
    .bind(attemptId, attempt.current_component_index)
    .first<{ id: string }>();

  const result = await recordIntegrityEvents(env, attemptId, events, {
    userAgent: context.userAgent,
    sessionId: activeSession?.id ?? null,
  });

  const all = await env.DB.prepare('SELECT type FROM integrity_events WHERE attempt_id = ?')
    .bind(attemptId)
    .all<{ type: string }>();
  const counts = countIntegrity(all.results.map((row) => row.type));
  const policy = resolvePolicy(attempt.mode, parseJson<Partial<IntegrityPolicy>>(attempt.integrity_policy_json, {}));
  const level = warningLevel(policy, counts.counted);

  let autoSubmitted = false;
  if (policy.autoSubmitAtEvents !== null && counts.counted >= policy.autoSubmitAtEvents) {
    await finalizeAttempt(env, attempt, 'INTEGRITY_AUTO');
    autoSubmitted = true;
  }

  return { recorded: result.recorded, counted: counts.counted, warningLevel: autoSubmitted ? 'CRITICAL' : level, autoSubmitted };
}

function countIntegrity(types: string[]) {
  const counted = types.filter((type) => isCountedEvent(type)).length;
  return {
    counted,
    tabAway: types.filter((type) => type === 'TAB_HIDDEN').length,
    fullscreenExits: types.filter((type) => type === 'FULLSCREEN_EXIT').length,
    copies: types.filter((type) => type === 'COPY_ATTEMPT').length,
    pastes: types.filter((type) => type === 'PASTE_ATTEMPT').length,
    interruptions: types.filter((type) => type === 'CONNECTION_INTERRUPTION').length,
    total: types.length,
  };
}

// -----------------------------------------------------------------------------
// Section transitions and submission
// -----------------------------------------------------------------------------
export async function advanceComponent(
  env: Env,
  user: AuthUser,
  attemptId: string,
): Promise<{ activeComponentIndex: number; submitted: boolean }> {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');
  if (attempt.status !== 'IN_PROGRESS') throw new ApiError('ATTEMPT_LOCKED', 'This attempt is already submitted.');

  await enforceTime(env, attempt);

  const sessions = await env.DB.prepare(
    'SELECT * FROM attempt_skill_sessions WHERE attempt_id = ? ORDER BY component_index',
  )
    .bind(attemptId)
    .all<SkillSessionRow>();

  const currentIndex = attempt.current_component_index;
  const current = sessions.results.find((session) => session.component_index === currentIndex);
  const next = sessions.results.find((session) => session.component_index === currentIndex + 1);

  const timestamp = nowIso();
  if (current && current.status === 'IN_PROGRESS') {
    await env.DB.prepare(
      `UPDATE attempt_skill_sessions SET status = 'SUBMITTED', submitted_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(timestamp, timestamp, current.id)
      .run();
  }

  if (!next) {
    await finalizeAttempt(env, attempt, 'CANDIDATE');
    return { activeComponentIndex: currentIndex, submitted: true };
  }

  if (next.status === 'NOT_STARTED') {
    await env.DB.prepare(
      `UPDATE attempt_skill_sessions
          SET status = 'IN_PROGRESS', started_at = ?, deadline_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        timestamp,
        next.duration_seconds ? addSeconds(timestamp, next.duration_seconds) : null,
        timestamp,
        next.id,
      )
      .run();
  }

  await env.DB.prepare('UPDATE attempts SET current_component_index = ?, updated_at = ? WHERE id = ?')
    .bind(next.component_index, timestamp, attemptId)
    .run();

  await recordIntegrityEvents(env, attemptId, [
    { type: 'SESSION_RESUME', metadata: { componentIndex: next.component_index, skill: next.skill } },
  ]);

  return { activeComponentIndex: next.component_index, submitted: false };
}

export async function submitAttempt(
  env: Env,
  user: AuthUser,
  attemptId: string,
  reason: 'CANDIDATE' | 'TIMEOUT' | 'INTEGRITY_AUTO' | 'ADMIN' = 'CANDIDATE',
): Promise<{ status: string; rawScore: number | null; totalQuestions: number | null; estimatedBand: number | null }> {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');

  if (attempt.status !== 'IN_PROGRESS') {
    return {
      status: attempt.status,
      rawScore: attempt.raw_score,
      totalQuestions: attempt.total_questions,
      estimatedBand: attempt.estimated_band,
    };
  }

  await finalizeAttempt(env, attempt, reason);
  const refreshed = await env.DB.prepare(
    'SELECT status, raw_score, total_questions, estimated_band FROM attempts WHERE id = ?',
  )
    .bind(attemptId)
    .first<{ status: string; raw_score: number | null; total_questions: number | null; estimated_band: number | null }>();

  return {
    status: refreshed?.status ?? 'SUBMITTED',
    rawScore: refreshed?.raw_score ?? null,
    totalQuestions: refreshed?.total_questions ?? null,
    estimatedBand: refreshed?.estimated_band ?? null,
  };
}

/** Locks the attempt, marks objective sections server-side and stores the result. */
export async function finalizeAttempt(
  env: Env,
  attempt: AttemptRow,
  reason: 'CANDIDATE' | 'TIMEOUT' | 'INTEGRITY_AUTO' | 'ADMIN',
): Promise<void> {
  const timestamp = nowIso();

  const guard = await env.DB.prepare(
    `UPDATE attempts SET status = 'SUBMITTED', submitted_at = ?, submitted_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'IN_PROGRESS'`,
  )
    .bind(timestamp, reason, timestamp, attempt.id)
    .run();

  const changes = (guard.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (changes === 0) return; // another request already submitted it

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE attempt_skill_sessions
          SET status = CASE WHEN status IN ('IN_PROGRESS','NOT_STARTED') THEN 'SUBMITTED' ELSE status END,
              submitted_at = COALESCE(submitted_at, ?),
              updated_at = ?
        WHERE attempt_id = ?`,
    ).bind(timestamp, timestamp, attempt.id),
    env.DB.prepare(
      `UPDATE writing_submissions SET submitted_at = ?, updated_at = ? WHERE attempt_id = ? AND submitted_at IS NULL`,
    ).bind(timestamp, timestamp, attempt.id),
  ]);

  await recordIntegrityEvents(env, attempt.id, [{ type: 'SUBMIT', metadata: { reason } }]);

  try {
    await markAttempt(env, attempt.id);
  } catch (error) {
    // Marking can be retried; the attempt stays submitted either way.
    console.error('marking_failed', attempt.id, (error as Error).message);
  }
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------
export interface AttemptResultView {
  attemptId: string;
  testId: string;
  testTitle: string;
  testType: TestType;
  testVersionId: string;
  versionNumber: number;
  mode: ExamMode;
  status: AttemptRow['status'];
  startedAt: string;
  submittedAt: string | null;
  durationSeconds: number | null;
  resultVisibility: ResultVisibility;
  release: {
    reviewAvailable: boolean;
    scoreAvailable: boolean;
    reason: string;
    releasesAt: string | null;
  };
  rawScore: number | null;
  totalQuestions: number | null;
  estimatedBand: number | null;
  bandNote: string | null;
  sessions: Array<
    SessionMarkResult & {
      label: string;
      componentIndex: number;
      startedAt: string | null;
      submittedAt: string | null;
      status: string;
      review: QuestionReview[] | null;
      writing: Array<{
        submissionId: string;
        questionId: string;
        taskLabel: string;
        responseText: string;
        wordCount: number;
        prompt: string;
        score: { band: number | null; feedback: string; source: string; scoredAt: string; criteria: Record<string, number> } | null;
      }>;
    }
  >;
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
}

export interface QuestionReview {
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
}

export async function loadAttemptResult(
  env: Env,
  user: AuthUser,
  attemptId: string,
): Promise<AttemptResultView> {
  const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?').bind(attemptId).first<AttemptRow>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  if (attempt.user_id !== user.id && user.role === 'STUDENT') {
    throw ApiError.forbidden('This attempt belongs to another user.');
  }
  return buildResultView(env, attempt, { includeReview: user.id === attempt.user_id || user.role !== 'STUDENT' });
}

export async function buildResultView(
  env: Env,
  attempt: AttemptRow,
  options: { includeReview: boolean; viewerIsStaff?: boolean },
): Promise<AttemptResultView> {
  const [test, version, sessions, integrityRows] = await Promise.all([
    env.DB.prepare('SELECT title FROM tests WHERE id = ?').bind(attempt.test_id).first<{ title: string }>(),
    env.DB.prepare('SELECT version_number, is_complete_test FROM test_versions WHERE id = ?')
      .bind(attempt.test_version_id)
      .first<{ version_number: number; is_complete_test: number }>(),
    env.DB.prepare(
      `SELECT s.*, v.is_complete_test, v.scoring_profile_id AS version_profile_id
         FROM attempt_skill_sessions s
         JOIN test_versions v ON v.id = s.test_version_id
        WHERE s.attempt_id = ? ORDER BY s.component_index`,
    )
      .bind(attempt.id)
      .all<SkillSessionRow & { is_complete_test: number; version_profile_id: string | null }>(),
    env.DB.prepare(
      'SELECT type, occurred_at, severity FROM integrity_events WHERE attempt_id = ? ORDER BY recorded_at',
    )
      .bind(attempt.id)
      .all<{ type: string; occurred_at: string; severity: string }>(),
  ]);

  const assignment = attempt.assignment_id
    ? await env.DB.prepare('SELECT deadline_at, result_visibility FROM assignments WHERE id = ?')
        .bind(attempt.assignment_id)
        .first<{ deadline_at: string | null; result_visibility: ResultVisibility }>()
    : null;

  const release = evaluateRelease(attempt, assignment ?? null);

  const sessionViews: AttemptResultView['sessions'] = [];
  for (const session of sessions.results) {
    const writingRows = await env.DB.prepare(
      `SELECT w.id, w.question_id, w.task_label, w.response_text, w.word_count,
              q.prompt,
              s.band, s.feedback, s.scoring_source, s.scored_at, s.criteria_json
         FROM writing_submissions w
         LEFT JOIN questions q ON q.id = w.question_id
         LEFT JOIN writing_scores s ON s.writing_submission_id = w.id
        WHERE w.attempt_id = ? AND w.skill_session_id = ?
        ORDER BY w.created_at`,
    )
      .bind(attempt.id, session.id)
      .all<{
        id: string;
        question_id: string;
        task_label: string;
        response_text: string;
        word_count: number;
        prompt: string | null;
        band: number | null;
        feedback: string | null;
        scoring_source: string | null;
        scored_at: string | null;
        criteria_json: string | null;
      }>();

    let review: QuestionReview[] | null = null;
    if (release.reviewAvailable && options.includeReview) {
      review = await buildQuestionReview(env, attempt.id, session.id, session.skill);
    }

    sessionViews.push({
      skillSessionId: session.id,
      componentIndex: session.component_index,
      skill: session.skill,
      label: session.label,
      startedAt: session.started_at,
      submittedAt: session.submitted_at,
      status: session.status,
      rawScore: session.raw_score ?? 0,
      totalQuestions: session.total_questions ?? 0,
      band: session.estimated_band,
      bandAvailable: session.estimated_band !== null,
      bandMessage:
        session.skill === 'WRITING'
          ? 'Writing is assessed by a teacher or administrator.'
          : session.estimated_band !== null
            ? 'Estimated band'
            : session.total_questions && session.total_questions > 0
              ? 'No scoring profile applies to this test, so only the raw score is reported.'
              : 'This section has no automatically marked questions.',
      profileId: session.scoring_profile_id,
      profileVersion: session.scoring_profile_version,
      review,
      writing: writingRows.results.map((row) => ({
        submissionId: row.id,
        questionId: row.question_id,
        taskLabel: row.task_label,
        responseText: options.includeReview ? row.response_text : '',
        wordCount: row.word_count,
        prompt: row.prompt ?? '',
        score: row.scoring_source
          ? {
              band: row.band,
              feedback: row.feedback ?? '',
              source: row.scoring_source,
              scoredAt: row.scored_at ?? '',
              criteria: parseJson<Record<string, number>>(row.criteria_json, {}),
            }
          : null,
      })),
    });
  }

  const counts = countIntegrity(integrityRows.results.map((row) => row.type));
  const submittedAt = attempt.submitted_at;
  const durationSeconds =
    submittedAt && attempt.started_at
      ? Math.max(0, Math.round((new Date(submittedAt).getTime() - new Date(attempt.started_at).getTime()) / 1000))
      : null;

  const bandNote = attempt.estimated_band !== null
    ? 'Estimated band from the scoring profile in force for this attempt. This is a practice indication, not an official IELTS result.'
    : null;

  return {
    attemptId: attempt.id,
    testId: attempt.test_id,
    testTitle: test?.title ?? 'Test',
    testType: attempt.test_type,
    testVersionId: attempt.test_version_id,
    versionNumber: version?.version_number ?? 1,
    mode: attempt.mode,
    status: attempt.status,
    startedAt: attempt.started_at,
    submittedAt,
    durationSeconds,
    resultVisibility: attempt.result_visibility,
    release,
    rawScore: release.scoreAvailable ? attempt.raw_score : null,
    totalQuestions: release.scoreAvailable ? attempt.total_questions : null,
    estimatedBand: release.scoreAvailable ? attempt.estimated_band : null,
    bandNote,
    sessions: sessionViews,
    integrity: {
      ...counts,
      events: integrityRows.results.map((row) => ({
        type: row.type,
        occurredAt: row.occurred_at,
        severity: row.severity,
      })),
      statement:
        'These are observable browser events recorded during the attempt. They do not by themselves demonstrate misconduct, and the platform cannot block operating-system actions such as Alt+Tab or detect the use of another device.',
    },
  };
}

function evaluateRelease(
  attempt: AttemptRow,
  assignment: { deadline_at: string | null; result_visibility: ResultVisibility } | null,
): { reviewAvailable: boolean; scoreAvailable: boolean; reason: string; releasesAt: string | null } {
  const visibility: ResultVisibility = assignment?.result_visibility ?? attempt.result_visibility;
  const isSubmitted = attempt.status !== 'IN_PROGRESS';

  if (!isSubmitted) {
    return { reviewAvailable: false, scoreAvailable: false, reason: 'The attempt is still in progress.', releasesAt: null };
  }
  if (attempt.test_type === 'WRITING' && visibility !== 'NO_REVIEW') {
    return {
      reviewAvailable: true,
      scoreAvailable: true,
      reason: 'Writing responses are available; scores appear once a teacher or administrator marks them.',
      releasesAt: null,
    };
  }

  switch (visibility) {
    case 'IMMEDIATE':
      return { reviewAvailable: true, scoreAvailable: true, reason: 'Results are released immediately.', releasesAt: null };
    case 'SCORE_ONLY':
      return {
        reviewAvailable: false,
        scoreAvailable: true,
        reason: 'Only the score has been released for this assignment.',
        releasesAt: null,
      };
    case 'AFTER_DEADLINE': {
      if (!assignment?.deadline_at) {
        return { reviewAvailable: true, scoreAvailable: true, reason: 'Results are released immediately.', releasesAt: null };
      }
      const released = new Date(assignment.deadline_at).getTime() <= Date.now();
      return {
        reviewAvailable: released,
        scoreAvailable: released,
        reason: released
          ? 'Results were released after the assignment deadline.'
          : 'Results become available after the assignment deadline.',
        releasesAt: assignment.deadline_at,
      };
    }
    case 'NO_REVIEW':
      return {
        reviewAvailable: false,
        scoreAvailable: false,
        reason: 'Your teacher has not released results for this assignment.',
        releasesAt: null,
      };
    default:
      return { reviewAvailable: false, scoreAvailable: false, reason: 'Results are unavailable.', releasesAt: null };
  }
}

async function buildQuestionReview(
  env: Env,
  attemptId: string,
  sessionId: string,
  skill: Skill,
): Promise<QuestionReview[]> {
  if (skill === 'WRITING') return [];

  const rows = await env.DB.prepare(
    `SELECT q.id AS question_id, q.number, q.prompt, g.question_type,
            a.answer_json, a.is_correct, a.points,
            k.answer_json AS key_json, k.evidence, k.explanation
       FROM questions q
       JOIN question_groups g ON g.id = q.question_group_id
       LEFT JOIN attempt_answers a ON a.question_id = q.id AND a.attempt_id = ?
       LEFT JOIN answer_keys k ON k.question_id = q.id
      WHERE q.test_version_id = (SELECT test_version_id FROM attempt_skill_sessions WHERE id = ?)
      ORDER BY q.number`,
  )
    .bind(attemptId, sessionId)
    .all<{
      question_id: string;
      number: number;
      prompt: string;
      question_type: string;
      answer_json: string | null;
      is_correct: number | null;
      points: number | null;
      key_json: string | null;
      evidence: string | null;
      explanation: string | null;
    }>();

  return rows.results
    .filter((row) => row.question_type !== 'WRITING_TASK_1' && row.question_type !== 'WRITING_TASK_2')
    .map((row) => {
      const key = row.key_json ? parseJson<Record<string, unknown> | null>(row.key_json, null) : null;
      let correctAnswer: string | null = null;
      if (key) {
        if (Array.isArray(key.values)) correctAnswer = (key.values as string[]).join(' / ');
        else if (Array.isArray(key.accept)) correctAnswer = (key.accept as string[]).join(' / ');
      }
      return {
        questionId: row.question_id,
        number: row.number,
        prompt: row.prompt,
        candidateAnswer: row.answer_json
          ? parseJson<CandidateResponse | null>(row.answer_json, null)
          : null,
        correctAnswer,
        isCorrect: row.is_correct === null ? null : row.is_correct === 1,
        points: row.points,
        pointsPossible: 1,
        questionType: row.question_type,
        evidence: row.evidence,
        explanation: row.explanation,
      } satisfies QuestionReview;
    });
}

export { isQuestionType };
