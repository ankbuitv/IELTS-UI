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
import { sectionDisplayLabel, type SectionPolicy } from '../../shared/sections';
import type { CandidatePassage } from '../../shared/question-types';
import { resolveVersionSectionPolicy, type ExamMode, ResultVisibility, Skill, TestType } from '../../shared/types';
import { resolveAssetUrl } from './media-service';
import { loadPlatformSettings } from '../lib/settings';

/** Per-section performance block in a result view (36). */
export interface AttemptSectionResult {
  sectionId: string;
  orderIndex: number;
  skill: Skill;
  /** Normalised structural type (READING_PASSAGE | LISTENING_PART | WRITING_TASK). */
  type: string;
  label: string;
  title: string;
  totalQuestions: number;
  answeredCount: number;
  flaggedCount: number;
  rawScore: number | null;
  correctCount: number | null;
  /** Review material — present only after review is released (37). */
  passage: (Omit<CandidatePassage, 'subtitle'> & { subtitle: string | null }) | null;
  audio: { assetId: string; url: string; durationSeconds: number | null } | null;
  image: { assetId: string; url: string } | null;
  transcript: { segments: Array<{ id: string; startSeconds: number | null; speaker: string | null; text: string }> } | null;
}

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

/** Server-side per-section attempt state (`attempt_sections`, 38/39/40). */
export interface AttemptSectionRow {
  id: string;
  attempt_id: string;
  section_id: string;
  section_order: number;
  skill: Skill;
  label: string;
  title: string;
  duration_seconds: number | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED';
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  total_questions: number;
  answered_count: number;
  flagged_count: number;
}

/** Candidate-visible per-section progress and timing (shared shape). */
export type { AttemptSectionState } from '../../shared/candidate';
import type { AttemptSectionState } from '../../shared/candidate';

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

  // 38/39/40: snapshot the section structure for this attempt (also creates
  // server-side per-section timers when the version's policy enables them).
  await initializeAttemptSections(env, attemptId, plan.components, startedAt, resolveVersionSectionPolicy(versionConfig));

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

  // A one-file full mock has no components: its own sections ARE the exam.
  // Group them into contiguous skill runs (Listening…, Reading…, Writing…)
  // so the attempt still gets one timed skill session per part, in paper order.
  let planRows = components.results;
  if (planRows.length === 0) {
    planRows = await inlineMockComponentRows(env, versionId);
  }
  if (planRows.length === 0) {
    throw ApiError.conflict('This full mock has no components configured.');
  }

  return {
    timed: assignment?.timing_policy !== 'UNTIMED',
    components: planRows.map((component) => ({
      skill: component.skill,
      testVersionId: component.test_version_id,
      label: component.label || `${component.skill} ${component.test_version_id.slice(-4)}`,
      durationSeconds: resolveDuration(component.skill, component.duration_seconds || component.version_duration),
      breakAfterSeconds: component.break_after_seconds ?? 0,
    })),
  };
}

/** Standard IELTS skill length, used when a mock's sections carry no timing. */
const INLINE_SKILL_SECONDS: Record<Skill, number> = { LISTENING: 1800, READING: 3600, WRITING: 3600 };

/**
 * Derives component rows from the mock version's own sections: one component
 * per contiguous run of the same skill, in section order (so Listening →
 * Reading → Writing stays in paper order). The rows mirror the shape of the
 * `mock_components` query above so the plan mapping stays identical.
 */
async function inlineMockComponentRows(
  env: Env,
  versionId: string,
): Promise<Array<{ skill: Skill; test_version_id: string; label: string; duration_seconds: number; break_after_seconds: number; version_duration: number | null }>> {
  const sections = await env.DB.prepare(
    `SELECT skill, duration_seconds FROM sections WHERE test_version_id = ? ORDER BY order_index, id`,
  )
    .bind(versionId)
    .all<{ skill: Skill; duration_seconds: number | null }>();

  const runs: Array<{ skill: Skill; seconds: number }> = [];
  for (const section of sections.results) {
    const last = runs[runs.length - 1];
    if (last && last.skill === section.skill) {
      last.seconds += section.duration_seconds ?? 0;
    } else {
      runs.push({ skill: section.skill, seconds: section.duration_seconds ?? 0 });
    }
  }
  return runs.map((run) => ({
    skill: run.skill,
    test_version_id: versionId,
    label: run.skill.charAt(0) + run.skill.slice(1).toLowerCase(),
    duration_seconds: run.seconds > 0 ? run.seconds : INLINE_SKILL_SECONDS[run.skill],
    break_after_seconds: 0,
    version_duration: null,
  }));
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

/**
 * Snapshots the section/part structure of every component version into
 * `attempt_sections` (38/40): historical attempts keep the structure of their
 * original version, and progress is tracked server-side. When the version's
 * policy enables part timing (39), cumulative deadlines are derived from each
 * section's `duration_seconds`; otherwise deadlines stay NULL and navigation
 * is free.
 */
async function initializeAttemptSections(
  env: Env,
  attemptId: string,
  components: ComponentPlan['components'],
  startedAt: string,
  policy: SectionPolicy,
): Promise<void> {
  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  let cursorSeconds = 0;
  let firstOpen = true;
  // Sections run continuously across the whole attempt: `section_order` is a
  // global position (Listening 0-…, then Reading, then Writing). Using each
  // version's own `order_index` here would interleave sections of a full mock
  // whenever its parts number their sections from 0 (Listening 0, Reading 0-2,
  // Writing 0-1 → 0,0,1,2,0,1), so candidates would jump between skills.
  let globalSectionOrder = 0;
  // A one-file mock's skill runs all point at the same version, so each of its
  // sections must be snapshotted exactly once.
  const seenSectionIds = new Set<string>();

  for (const component of components) {
    const sections = await env.DB.prepare(
      `SELECT s.id, s.skill, s.order_index, s.title, s.label, s.duration_seconds,
              (SELECT COUNT(*) FROM questions q WHERE q.section_id = s.id) AS total_questions
         FROM sections s
        WHERE s.test_version_id = ?
        ORDER BY s.order_index, s.id`,
    )
      .bind(component.testVersionId)
      .all<{
        id: string;
        skill: Skill;
        order_index: number;
        title: string;
        label: string;
        duration_seconds: number | null;
        total_questions: number;
      }>();

    const partTiming = policy.navigation !== 'FREE_NAVIGATION';
    for (const section of sections.results) {
      if (seenSectionIds.has(section.id)) continue;
      seenSectionIds.add(section.id);
      const deadline =
        partTiming && section.duration_seconds
          ? addSeconds(startedAt, cursorSeconds + section.duration_seconds)
          : null;
      const isActive = firstOpen && component.testVersionId === components[0]?.testVersionId;
      if (isActive) firstOpen = false;
      if (isActive || deadline) {
        cursorSeconds += section.duration_seconds ?? 0;
      }
      statements.push(
        env.DB.prepare(
          `INSERT INTO attempt_sections (id, attempt_id, section_id, section_order, skill, label, title,
                                         duration_seconds, status, started_at, deadline_at, total_questions,
                                         created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId('asec'),
          attemptId,
          section.id,
          globalSectionOrder++,
          section.skill,
          sectionDisplayLabel({ label: section.label, skill: section.skill, orderIndex: section.order_index, title: section.title }),
          section.title,
          section.duration_seconds,
          isActive ? 'IN_PROGRESS' : 'NOT_STARTED',
          isActive ? startedAt : null,
          isActive ? deadline : deadline,
          section.total_questions,
          timestamp,
          timestamp,
        ),
      );
    }
  }

  if (statements.length > 0) {
    for (let i = 0; i < statements.length; i += 40) {
      await env.DB.batch(statements.slice(i, i + 40));
    }
  }
}

/** Recomputes answered/flagged counters per section from `attempt_answers` (38). */
export async function refreshAttemptSectionProgress(env: Env, attemptId: string): Promise<void> {
  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE attempt_sections
        SET answered_count = (
              SELECT COUNT(*) FROM attempt_answers aa
               WHERE aa.attempt_id = attempt_sections.attempt_id
                 AND aa.question_id IN (SELECT id FROM questions WHERE section_id = attempt_sections.section_id)
                 AND aa.answer_json IS NOT NULL AND aa.answer_json != '' AND aa.answer_json != 'null'
            ) + COALESCE((
              SELECT COUNT(*) FROM writing_submissions ws
               JOIN questions q2 ON q2.id = ws.question_id
                WHERE ws.attempt_id = attempt_sections.attempt_id
                  AND q2.section_id = attempt_sections.section_id
                  AND TRIM(ws.response_text) != ''
            ), 0),
            flagged_count = (
              SELECT COUNT(*) FROM attempt_answers af
               WHERE af.attempt_id = attempt_sections.attempt_id
                 AND af.question_id IN (SELECT id FROM questions WHERE section_id = attempt_sections.section_id)
                 AND af.is_flagged = 1
            ),
            updated_at = ?
      WHERE attempt_id = ?`,
  )
    .bind(timestamp, attemptId)
    .run();
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

  // ---- per-section/part timers (39, server-authoritative) ------------------
  const partExpiry = await enforceSectionTimers(env, attempt, sessions.results);
  if (partExpiry?.finalised) {
    return {
      serverNow: now,
      attemptDeadline: attempt.deadline_at,
      attemptRemainingSeconds: remainingSeconds(attempt.deadline_at),
      activeSessionId: active?.id ?? null,
      sessionRemainingSeconds: sessionRemaining,
      sessionDeadline: active?.deadline_at ?? null,
      autoSubmitted: true,
    };
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

interface SectionTimerOutcome {
  finalised: boolean;
  advanced: boolean;
}

/**
 * Closes sections whose part deadline has passed. Configuration decides what
 * happens next (39): with `autoAdvanceOnPartTimeout` the next part opens
 * immediately; otherwise the part closes and the candidate advances manually.
 * The overall attempt deadline always remains the hard cap.
 */
async function enforceSectionTimers(env: Env, attempt: AttemptRow, sessions: SkillSessionRow[]): Promise<SectionTimerOutcome | null> {
  const expired = await env.DB.prepare(
    `SELECT * FROM attempt_sections
      WHERE attempt_id = ? AND status = 'IN_PROGRESS' AND deadline_at IS NOT NULL AND deadline_at <= ?`,
  )
    .bind(attempt.id, nowIso())
    .all<AttemptSectionRow>();

  if (expired.results.length === 0) return null;

  const attemptSections = (
    await env.DB.prepare(
      'SELECT * FROM attempt_sections WHERE attempt_id = ? ORDER BY section_order',
    )
      .bind(attempt.id)
      .all<AttemptSectionRow>()
  ).results;

  // Load the policy recorded for this attempt (frozen at creation).
  const versionRow = await env.DB.prepare('SELECT config_json FROM test_versions WHERE id = ?')
    .bind(attempt.test_version_id)
    .first<{ config_json: string }>();
  const policy = resolveVersionSectionPolicy(parseJson<Record<string, unknown>>(versionRow?.config_json ?? '{}', {}));

  const timestamp = nowIso();
  let finalised = false;
  let advanced = false;

  for (const section of expired.results) {
    await env.DB.prepare(
      `UPDATE attempt_sections SET status = 'EXPIRED', submitted_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(timestamp, timestamp, section.id)
      .run();

    const index = attemptSections.findIndex((row) => row.id === section.id);
    const next = attemptSections
      .slice(index + 1)
      .find((row) => row.status === 'NOT_STARTED' && row.skill === section.skill);

    if (policy.autoAdvanceOnPartTimeout && next) {
      await env.DB.prepare(
        `UPDATE attempt_sections SET status = 'IN_PROGRESS', started_at = ?, deadline_at = ?, updated_at = ?
          WHERE id = ?`,
      )
        .bind(timestamp, next.duration_seconds ? addSeconds(timestamp, next.duration_seconds) : null, timestamp, next.id)
        .run();
      advanced = true;
      continue;
    }

    const activeSession = sessions.find((session) => session.skill === section.skill && session.component_index === attempt.current_component_index);
    const hasMoreSections = attemptSections.some((row) => row.skill === section.skill && row.status === 'NOT_STARTED');
    if (!hasMoreSections && !policy.autoAdvanceOnPartTimeout && attempt.test_type !== 'FULL_MOCK' && activeSession) {
      // Last part of a single-skill test timed out without auto-advance: the
      // part time is the component time, so the attempt closes.
      await finalizeAttempt(env, attempt, 'TIMEOUT');
      finalised = true;
    }
  }

  return { finalised, advanced };
}

/**
 * Candidate finished a section/part: closes it and opens the next one the
 * policy allows (34/39). In FREE_NAVIGATION this is advisory; in sequential
 * modes it is the only way forward, and completed parts reopen only when
 * `allowReturnToPreviousParts` is set.
 */
export async function completeSection(
  env: Env,
  user: AuthUser,
  attemptId: string,
  sectionId: string | null,
): Promise<{ sections: AttemptSectionState[]; submitted: boolean }> {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('This attempt belongs to another user.');
  if (attempt.status !== 'IN_PROGRESS') throw new ApiError('ATTEMPT_LOCKED', 'This attempt is already submitted.');
  await enforceTime(env, attempt);

  const rows = await env.DB.prepare('SELECT * FROM attempt_sections WHERE attempt_id = ? ORDER BY section_order')
    .bind(attemptId)
    .all<AttemptSectionRow>();
  if (rows.results.length === 0) throw ApiError.conflict('This attempt has no section state.');

  const policy = await loadAttemptSectionPolicy(env, attempt);
  const target = sectionId
    ? rows.results.find((row) => row.section_id === sectionId)
    : rows.results.find((row) => row.status === 'IN_PROGRESS');
  if (!target) throw ApiError.notFound('Section not found in this attempt.');
  if (target.status !== 'IN_PROGRESS') throw ApiError.conflict('Only the current section can be completed.');

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE attempt_sections SET status = 'COMPLETED', submitted_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(timestamp, timestamp, target.id)
    .run();

  const next = rows.results
    .slice(rows.results.findIndex((row) => row.id === target.id) + 1)
    .find((row) => row.status === 'NOT_STARTED');

  let submitted = false;
  if (next) {
    await env.DB.prepare(
      `UPDATE attempt_sections SET status = 'IN_PROGRESS', started_at = ?, deadline_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(timestamp, next.duration_seconds ? addSeconds(timestamp, next.duration_seconds) : null, timestamp, next.id)
      .run();
  } else if (attempt.test_type !== 'FULL_MOCK' && policy.navigation !== 'FREE_NAVIGATION') {
    // Advancing past the last part completes the attempt.
    await finalizeAttempt(env, attempt, 'CANDIDATE');
    submitted = true;
  }

  await refreshAttemptSectionProgress(env, attemptId);
  const sections = await loadAttemptSectionState(env, attemptId);
  return { sections, submitted };
}

async function loadAttemptSectionPolicy(env: Env, attempt: AttemptRow): Promise<SectionPolicy> {
  const versionRow = await env.DB.prepare('SELECT config_json FROM test_versions WHERE id = ?')
    .bind(attempt.test_version_id)
    .first<{ config_json: string }>();
  return resolveVersionSectionPolicy(parseJson<Record<string, unknown>>(versionRow?.config_json ?? '{}', {}));
}

/** Server-derived per-section progress for one attempt (38). */
export async function loadAttemptSectionState(env: Env, attemptId: string): Promise<AttemptSectionState[]> {
  const rows = await env.DB.prepare('SELECT * FROM attempt_sections WHERE attempt_id = ? ORDER BY section_order')
    .bind(attemptId)
    .all<AttemptSectionRow>();
  return rows.results.map((row) => ({
    sectionId: row.section_id,
    orderIndex: row.section_order,
    skill: row.skill,
    label: row.label,
    title: row.title,
    status: row.status,
    durationSeconds: row.duration_seconds,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    remainingSeconds: row.deadline_at && row.status === 'IN_PROGRESS' ? remainingSeconds(row.deadline_at) : null,
    totalQuestions: row.total_questions,
    answeredCount: row.answered_count,
    flaggedCount: row.flagged_count,
  }));
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
  /** Server-authoritative per-section progress/timing (38/39). */
  sections: AttemptSectionState[];
  /** Section navigation policy frozen for this attempt (34/39). */
  sectionPolicy: SectionPolicy;
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

  // Server-derived section progress (38) and the policy frozen for the attempt.
  const [sectionRows, versionConfigRow] = await Promise.all([
    loadAttemptSectionState(env, attemptId),
    env.DB.prepare('SELECT config_json FROM test_versions WHERE id = ?').bind(current.test_version_id).first<{ config_json: string }>(),
  ]);
  const sectionPolicy = resolveVersionSectionPolicy(parseJson<Record<string, unknown>>(versionConfigRow?.config_json ?? '{}', {}));

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
    sections: sectionRows,
    sectionPolicy,
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
  let validIds = new Set(validQuestions.results.map((row) => row.id));

  // 34/39: in sequential or locked part modes only the open part accepts
  // answers. Legacy attempts without section rows keep unrestricted access.
  const sectionPolicy = await loadAttemptSectionPolicy(env, attempt);
  if (sectionPolicy.navigation !== 'FREE_NAVIGATION') {
    const sectionRows = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM attempt_sections WHERE attempt_id = ?',
    )
      .bind(attemptId)
      .first<{ count: number }>();
    if ((sectionRows?.count ?? 0) > 0) {
      const openSections = await env.DB.prepare(
        `SELECT section_id FROM attempt_sections WHERE attempt_id = ? AND status = 'IN_PROGRESS'`,
      )
        .bind(attemptId)
        .all<{ section_id: string }>();
      const openIds = new Set(openSections.results.map((row) => row.section_id));
      const openQuestions = await env.DB.prepare(
        `SELECT id FROM questions
          WHERE test_version_id = ? AND section_id IN (SELECT section_id FROM attempt_sections WHERE attempt_id = ? AND status = 'IN_PROGRESS')`,
      )
        .bind(active.test_version_id, attemptId)
        .all<{ id: string }>();
      const openQuestionIds = new Set(openQuestions.results.map((row) => row.id));
      validIds = new Set([...validIds].filter((id) => openQuestionIds.has(id)));
      void openIds;
    }
  }

  const timestamp = nowIso();
  const statements: D1PreparedStatement[] = [];
  let saved = 0;

  for (const update of updates) {
    if (!validIds.has(update.questionId)) {
      throw ApiError.conflict(
        'That question belongs to a part that is not open. Complete the current part first.',
      );
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
  await refreshAttemptSectionProgress(env, attemptId);
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

  await refreshAttemptSectionProgress(env, attemptId);

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
      `UPDATE attempt_sections
          SET status = CASE WHEN status = 'IN_PROGRESS' THEN 'COMPLETED' WHEN status = 'NOT_STARTED' THEN 'EXPIRED' ELSE status END,
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
      /** Per-section (passage/part/task) diagnostic breakdown (36). */
      sectionResults: AttemptSectionResult[];
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
  /** Section/part the question belongs to (37, review grouping). */
  sectionId: string | null;
  sectionLabel: string | null;
  sectionOrder: number | null;
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

    // 36: per-section diagnostic breakdown; review material is attached only
    // when the release policy allows review (37).
    const sectionResults = await buildSessionSectionResults(env, attempt.id, session.test_version_id, {
      includeReviewMaterial: release.reviewAvailable && options.includeReview,
    });

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
      sectionResults,
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
            q.section_id,
            s.label AS section_label, s.order_index AS section_order,
            a.answer_json, a.is_correct, a.points,
            k.answer_json AS key_json, k.evidence, k.explanation
       FROM questions q
       JOIN question_groups g ON g.id = q.question_group_id
       JOIN sections s ON s.id = q.section_id
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
      section_id: string;
      section_label: string | null;
      section_order: number | null;
      answer_json: string | null;
      is_correct: number | null;
      points: number | null;
      key_json: string | null;
      evidence: string | null;
      explanation: string | null;
    }>();

  const sectionLabels = new Map<string, string>();
  for (const row of rows.results) {
    if (!sectionLabels.has(row.section_id)) {
      sectionLabels.set(
        row.section_id,
        sectionDisplayLabel({
          label: row.section_label,
          orderIndex: row.section_order ?? 0,
          title: null,
        }),
      );
    }
  }

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
        sectionId: row.section_id,
        sectionLabel: sectionLabels.get(row.section_id) ?? null,
        sectionOrder: row.section_order,
      } satisfies QuestionReview;
    });
}

/**
 * Per-section performance for one skill session (36). Scores come only from
 * server-side marking (`attempt_answers.is_correct` / `points`); nothing is
 * converted into a standalone IELTS band here (41).
 */
async function buildSessionSectionResults(
  env: Env,
  attemptId: string,
  versionId: string,
  options: { includeReviewMaterial: boolean },
): Promise<AttemptSectionResult[]> {
  const sections = await env.DB.prepare(
    `SELECT s.id, s.skill, s.order_index, s.title, s.label, s.type,
            s.passage_id, s.audio_asset_id, s.image_asset_id, s.transcript_json,
            (SELECT COUNT(*) FROM questions q WHERE q.section_id = s.id) AS total_questions,
            (SELECT COUNT(*) FROM attempt_answers aa
               JOIN questions q2 ON q2.id = aa.question_id
              WHERE aa.attempt_id = ? AND q2.section_id = s.id
                AND aa.answer_json IS NOT NULL AND aa.answer_json != '' AND aa.answer_json != 'null') AS answered_count,
            (SELECT COUNT(*) FROM attempt_answers af
               JOIN questions q3 ON q3.id = af.question_id
              WHERE af.attempt_id = ? AND q3.section_id = s.id AND af.is_flagged = 1) AS flagged_count,
            (SELECT COALESCE(SUM(aa2.points), 0) FROM attempt_answers aa2
               JOIN questions q4 ON q4.id = aa2.question_id
              WHERE aa2.attempt_id = ? AND q4.section_id = s.id AND aa2.is_correct = 1) AS raw_score,
            (SELECT COUNT(*) FROM attempt_answers aa3
               JOIN questions q5 ON q5.id = aa3.question_id
              WHERE aa3.attempt_id = ? AND q5.section_id = s.id AND aa3.is_correct = 1) AS correct_count
       FROM sections s
      WHERE s.test_version_id = ?
      ORDER BY s.order_index, s.id`,
  )
    .bind(attemptId, attemptId, attemptId, attemptId, versionId)
    .all<{
      id: string;
      skill: Skill;
      order_index: number;
      title: string;
      label: string;
      type: string | null;
      passage_id: string | null;
      audio_asset_id: string | null;
      image_asset_id: string | null;
      transcript_json: string | null;
      total_questions: number;
      answered_count: number;
      flagged_count: number;
      raw_score: number | null;
      correct_count: number | null;
    }>();

  const marked = sections.results.some((section) => section.correct_count !== null && section.correct_count > 0) ||
    sections.results.some((section) => section.answered_count > 0 && section.raw_score !== null);

  const passageIds = sections.results.map((row) => row.passage_id).filter((id): id is string => Boolean(id));
  const assetIds = sections.results
    .flatMap((row) => [row.audio_asset_id, row.image_asset_id])
    .filter((id): id is string => Boolean(id));

  const passageRows = passageIds.length
    ? (
        await env.DB.prepare(
          `SELECT id, title, subtitle, body_json, word_count FROM passages WHERE id IN (${passageIds.map(() => '?').join(',')})`,
        )
          .bind(...passageIds)
          .all<{ id: string; title: string; subtitle: string | null; body_json: string; word_count: number }>()
      ).results
    : [];
  const passageById = new Map(passageRows.map((row) => [row.id, row]));

  const assetRows = options.includeReviewMaterial && assetIds.length
    ? (
        await env.DB.prepare(
          `SELECT id, kind, storage_kind, external_url, r2_key, duration_seconds FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`,
        )
          .bind(...assetIds)
          .all<{ id: string; kind: string; storage_kind: string; external_url: string | null; r2_key: string | null; duration_seconds: number | null }>()
      ).results
    : [];
  const assetById = new Map(assetRows.map((row) => [row.id, row]));

  return sections.results.map((row) => {
    const passageRow = options.includeReviewMaterial && row.passage_id ? passageById.get(row.passage_id) : undefined;
    const audioRow = options.includeReviewMaterial && row.audio_asset_id ? assetById.get(row.audio_asset_id) : undefined;
    const imageRow = options.includeReviewMaterial && row.image_asset_id ? assetById.get(row.image_asset_id) : undefined;
    const audioUrl = audioRow ? resolveAssetUrl(audioRow) : null;
    const imageUrl = imageRow ? resolveAssetUrl(imageRow) : null;
    return {
      sectionId: row.id,
      orderIndex: row.order_index,
      skill: row.skill,
      type: row.type ?? row.skill,
      label: sectionDisplayLabel({ label: row.label, type: row.type, skill: row.skill, orderIndex: row.order_index, title: row.title }),
      title: row.title,
      totalQuestions: row.total_questions,
      answeredCount: row.answered_count,
      flaggedCount: row.flagged_count,
      rawScore: marked ? (row.raw_score ?? 0) : null,
      correctCount: marked ? (row.correct_count ?? 0) : null,
      passage: passageRow
        ? {
            id: passageRow.id,
            title: passageRow.title,
            subtitle: passageRow.subtitle,
            paragraphs: parseJson<PassageParagraphLike[]>(passageRow.body_json, []),
            wordCount: passageRow.word_count,
          }
        : null,
      audio: audioRow && audioUrl
        ? { assetId: audioRow.id, url: audioUrl.startsWith('/') ? `/api/files/${audioRow.id}` : audioUrl, durationSeconds: audioRow.duration_seconds }
        : null,
      image: imageRow && imageUrl
        ? { assetId: imageRow.id, url: imageUrl.startsWith('/') ? `/api/files/${imageRow.id}` : imageUrl }
        : null,
      transcript: options.includeReviewMaterial ? parseTranscriptOrNull(row.transcript_json) : null,
    } satisfies AttemptSectionResult;
  });
}

interface PassageParagraphLike {
  label: string;
  text: string;
}

function parseTranscriptOrNull(value: string | null): AttemptSectionResult['transcript'] {
  if (!value) return null;
  const parsed = parseJson<{ segments?: Array<{ id: string; startSeconds: number | null; speaker: string | null; text: string }> } | null>(value, null);
  return parsed && Array.isArray(parsed.segments) ? { segments: parsed.segments } : null;
}

export { isQuestionType };
