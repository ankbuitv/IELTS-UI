import type { Env } from '../env';
import type { Skill, TestType } from '../../shared/types';
import { QUESTION_TYPE_META, isQuestionType } from '../../shared/question-types';
import { sectionDisplayLabel } from '../../shared/sections';

export interface AnalyticsFilters {
  from?: string | null;
  to?: string | null;
  skill?: Skill | null;
  testType?: TestType | null;
  limit?: number;
}

interface WhereClause {
  sql: string;
  bindings: unknown[];
}

function buildAttemptFilter(alias: string, filters: AnalyticsFilters, userId: string | null, userColumn = 'user_id'): WhereClause {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (userId) {
    conditions.push(`${alias}.${userColumn} = ?`);
    bindings.push(userId);
  }
  conditions.push(`${alias}.status IN ('SUBMITTED','EXPIRED')`);
  if (filters.from) {
    conditions.push(`${alias}.started_at >= ?`);
    bindings.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`${alias}.started_at <= ?`);
    bindings.push(filters.to);
  }
  if (filters.testType) {
    conditions.push(`${alias}.test_type = ?`);
    bindings.push(filters.testType);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', bindings };
}

export interface SkillPerformance {
  skill: Skill;
  sessions: number;
  rawScore: number;
  totalQuestions: number;
  accuracy: number | null;
  averageBand: number | null;
  bestBand: number | null;
  latestBand: number | null;
  writingScores: number;
  averageWritingBand: number | null;
}

export interface TaskTypePerformance {
  questionType: string;
  label: string;
  answered: number;
  correct: number;
  accuracy: number | null;
}

export interface AttemptSummary {
  attemptId: string;
  testId: string;
  testTitle: string;
  testType: TestType;
  mode: string;
  status: string;
  versionNumber: number;
  startedAt: string;
  submittedAt: string | null;
  rawScore: number | null;
  totalQuestions: number | null;
  estimatedBand: number | null;
  durationSeconds: number | null;
  assignmentId: string | null;
  assignmentTitle: string | null;
  resultVisibility: string;
}

export interface TrendPoint {
  date: string;
  attemptId: string;
  testType: TestType;
  skills: Array<{ skill: Skill; rawScore: number; totalQuestions: number; band: number | null }>;
  rawScore: number | null;
  totalQuestions: number | null;
  estimatedBand: number | null;
}

export interface AssignmentSummary {
  assignmentId: string;
  classroomId: string;
  classroomName: string;
  title: string;
  instructions: string;
  testId: string;
  testTitle: string;
  testType: TestType;
  versionNumber: number;
  startAt: string | null;
  deadlineAt: string | null;
  maxAttempts: number;
  attemptsUsed: number;
  mode: string;
  timingPolicy: string;
  resultVisibility: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'OVERDUE';
  inProgressAttemptId: string | null;
  lastSubmittedAt: string | null;
  bestRawScore: number | null;
  bestTotalQuestions: number | null;
  bestBand: number | null;
}

export async function listStudentAssignments(env: Env, userId: string): Promise<AssignmentSummary[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id AS assignment_id, a.classroom_id, c.name AS classroom_name, a.title, a.instructions,
            a.test_id, t.title AS test_title, t.type AS test_type, v.version_number,
            a.start_at, a.deadline_at, a.max_attempts, a.mode, a.timing_policy, a.result_visibility,
            (SELECT COUNT(*) FROM attempts x WHERE x.assignment_id = a.id AND x.user_id = ? AND x.status != 'ABANDONED') AS attempts_used,
            (SELECT x.id FROM attempts x WHERE x.assignment_id = a.id AND x.user_id = ? AND x.status = 'IN_PROGRESS' ORDER BY x.started_at DESC LIMIT 1) AS in_progress_attempt_id,
            (SELECT MAX(x.submitted_at) FROM attempts x WHERE x.assignment_id = a.id AND x.user_id = ?) AS last_submitted_at,
            (SELECT MAX(x.raw_score) FROM attempts x WHERE x.assignment_id = a.id AND x.user_id = ? AND x.status IN ('SUBMITTED','EXPIRED')) AS best_raw_score,
            (SELECT x.total_questions FROM attempts x WHERE x.assignment_id = a.id AND x.user_id = ? AND x.status IN ('SUBMITTED','EXPIRED') ORDER BY x.raw_score DESC LIMIT 1) AS best_total,
            (SELECT MAX(x.estimated_band) FROM attempts x WHERE x.assignment_id = a.id AND x.user_id = ? AND x.status IN ('SUBMITTED','EXPIRED')) AS best_band
       FROM assignments a
       JOIN classrooms c ON c.id = a.classroom_id
       JOIN tests t ON t.id = a.test_id
       JOIN test_versions v ON v.id = a.test_version_id
       JOIN classroom_members m ON m.classroom_id = a.classroom_id AND m.user_id = ? AND m.status = 'ACTIVE'
      WHERE a.status IN ('ACTIVE')
      ORDER BY (a.deadline_at IS NULL), a.deadline_at, a.start_at`,
  )
    .bind(userId, userId, userId, userId, userId, userId, userId)
    .all<{
      assignment_id: string;
      classroom_id: string;
      classroom_name: string;
      title: string;
      instructions: string;
      test_id: string;
      test_title: string;
      test_type: TestType;
      version_number: number;
      start_at: string | null;
      deadline_at: string | null;
      max_attempts: number;
      mode: string;
      timing_policy: string;
      result_visibility: string;
      attempts_used: number;
      in_progress_attempt_id: string | null;
      last_submitted_at: string | null;
      best_raw_score: number | null;
      best_total: number | null;
      best_band: number | null;
    }>();

  const now = Date.now();
  return rows.results.map((row) => {
    const overdue = Boolean(row.deadline_at && new Date(row.deadline_at).getTime() < now);
    const hasSubmission = Boolean(row.last_submitted_at);
    let status: AssignmentSummary['status'] = 'NOT_STARTED';
    if (row.in_progress_attempt_id) status = 'IN_PROGRESS';
    else if (hasSubmission && row.attempts_used >= Math.max(1, row.max_attempts)) status = 'SUBMITTED';
    else if (overdue) status = 'OVERDUE';
    else if (row.attempts_used > 0) status = 'IN_PROGRESS';

    return {
      assignmentId: row.assignment_id,
      classroomId: row.classroom_id,
      classroomName: row.classroom_name,
      title: row.title,
      instructions: row.instructions,
      testId: row.test_id,
      testTitle: row.test_title,
      testType: row.test_type,
      versionNumber: row.version_number,
      startAt: row.start_at,
      deadlineAt: row.deadline_at,
      maxAttempts: row.max_attempts,
      attemptsUsed: row.attempts_used,
      mode: row.mode,
      timingPolicy: row.timing_policy,
      resultVisibility: row.result_visibility,
      status,
      inProgressAttemptId: row.in_progress_attempt_id,
      lastSubmittedAt: row.last_submitted_at,
      bestRawScore: row.best_raw_score,
      bestTotalQuestions: row.best_total,
      bestBand: row.best_band,
    } satisfies AssignmentSummary;
  });
}

export async function listAttempts(
  env: Env,
  userId: string | null,
  filters: AnalyticsFilters,
  options: { assignmentId?: string | null; attemptIds?: string[] | null } = {},
): Promise<AttemptSummary[]> {
  const filter = buildAttemptFilter('a', filters, userId);
  const conditions = [filter.sql.replace(/^WHERE /, '')];
  const bindings = [...filter.bindings];

  if (options.assignmentId) {
    conditions.push('a.assignment_id = ?');
    bindings.push(options.assignmentId);
  }
  if (options.attemptIds && options.attemptIds.length > 0) {
    conditions.push(`a.id IN (${options.attemptIds.map(() => '?').join(',')})`);
    bindings.push(...options.attemptIds);
  }

  const where = conditions.filter(Boolean).length ? `WHERE ${conditions.filter(Boolean).join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  const rows = await env.DB.prepare(
    `SELECT a.id AS attempt_id, a.test_id, t.title AS test_title, a.test_type, a.mode, a.status,
            v.version_number, a.started_at, a.submitted_at, a.raw_score, a.total_questions, a.estimated_band,
            a.assignment_id, asg.title AS assignment_title, a.result_visibility
       FROM attempts a
       JOIN tests t ON t.id = a.test_id
       JOIN test_versions v ON v.id = a.test_version_id
       LEFT JOIN assignments asg ON asg.id = a.assignment_id
       ${where}
      ORDER BY a.started_at DESC
      LIMIT ${limit}`,
  )
    .bind(...bindings)
    .all<{
      attempt_id: string;
      test_id: string;
      test_title: string;
      test_type: TestType;
      mode: string;
      status: string;
      version_number: number;
      started_at: string;
      submitted_at: string | null;
      raw_score: number | null;
      total_questions: number | null;
      estimated_band: number | null;
      assignment_id: string | null;
      assignment_title: string | null;
      result_visibility: string;
    }>();

  return rows.results.map((row) => ({
    attemptId: row.attempt_id,
    testId: row.test_id,
    testTitle: row.test_title,
    testType: row.test_type,
    mode: row.mode,
    status: row.status,
    versionNumber: row.version_number,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    rawScore: row.raw_score,
    totalQuestions: row.total_questions,
    estimatedBand: row.estimated_band,
    durationSeconds: row.submitted_at
      ? Math.max(0, Math.round((new Date(row.submitted_at).getTime() - new Date(row.started_at).getTime()) / 1000))
      : null,
    assignmentId: row.assignment_id,
    assignmentTitle: row.assignment_title,
    resultVisibility: row.result_visibility,
  }));
}

export async function getSkillPerformance(
  env: Env,
  filters: AnalyticsFilters,
  userId: string | null,
  options: { classroomId?: string; userIds?: string[] } = {},
): Promise<SkillPerformance[]> {
  const conditions: string[] = ["a.status IN ('SUBMITTED','EXPIRED')", "s.status IN ('SUBMITTED','EXPIRED')"];
  const bindings: unknown[] = [];

  if (userId) {
    conditions.push('a.user_id = ?');
    bindings.push(userId);
  }
  if (options.userIds && options.userIds.length > 0) {
    conditions.push(`a.user_id IN (${options.userIds.map(() => '?').join(',')})`);
    bindings.push(...options.userIds);
  }
  if (options.classroomId) {
    conditions.push('a.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = ?)');
    bindings.push(options.classroomId);
  }
  if (filters.from) {
    conditions.push('a.started_at >= ?');
    bindings.push(filters.from);
  }
  if (filters.to) {
    conditions.push('a.started_at <= ?');
    bindings.push(filters.to);
  }
  if (filters.skill) {
    conditions.push('s.skill = ?');
    bindings.push(filters.skill);
  }
  if (filters.testType) {
    conditions.push('a.test_type = ?');
    bindings.push(filters.testType);
  }

  const rows = await env.DB.prepare(
    `SELECT s.skill,
            COUNT(*) AS sessions,
            COALESCE(SUM(s.raw_score), 0) AS raw_score,
            COALESCE(SUM(s.total_questions), 0) AS total_questions,
            AVG(s.estimated_band) AS average_band,
            MAX(s.estimated_band) AS best_band
       FROM attempt_skill_sessions s
       JOIN attempts a ON a.id = s.attempt_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.skill`,
  )
    .bind(...bindings)
    .all<{
      skill: Skill;
      sessions: number;
      raw_score: number;
      total_questions: number;
      average_band: number | null;
      best_band: number | null;
    }>();

  const latest = await env.DB.prepare(
    `SELECT s.skill, s.estimated_band
       FROM attempt_skill_sessions s
       JOIN attempts a ON a.id = s.attempt_id
      WHERE ${conditions.join(' AND ')} AND s.estimated_band IS NOT NULL
      ORDER BY a.submitted_at DESC
      LIMIT 20`,
  )
    .bind(...bindings)
    .all<{ skill: Skill; estimated_band: number }>();

  const latestBySkill = new Map<Skill, number>();
  for (const row of latest.results) {
    if (!latestBySkill.has(row.skill)) latestBySkill.set(row.skill, row.estimated_band);
  }

  const writingConditions = ["a.status IN ('SUBMITTED','EXPIRED')"];
  const writingBindings: unknown[] = [];
  if (userId) {
    writingConditions.push('a.user_id = ?');
    writingBindings.push(userId);
  }
  if (options.userIds && options.userIds.length > 0) {
    writingConditions.push(`a.user_id IN (${options.userIds.map(() => '?').join(',')})`);
    writingBindings.push(...options.userIds);
  }
  if (options.classroomId) {
    writingConditions.push('a.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = ?)');
    writingBindings.push(options.classroomId);
  }
  const writingRows = await env.DB.prepare(
    `SELECT COUNT(*) AS scored, AVG(ws.band) AS average_band
       FROM writing_scores ws
       JOIN writing_submissions w ON w.id = ws.writing_submission_id
       JOIN attempts a ON a.id = w.attempt_id
      WHERE ${writingConditions.join(' AND ')}`,
  )
    .bind(...writingBindings)
    .first<{ scored: number; average_band: number | null }>();

  const bySkill = new Map<Skill, SkillPerformance>();
  for (const row of rows.results) {
    bySkill.set(row.skill, {
      skill: row.skill,
      sessions: row.sessions,
      rawScore: row.raw_score,
      totalQuestions: row.total_questions,
      accuracy: row.total_questions > 0 ? Math.round((row.raw_score / row.total_questions) * 1000) / 10 : null,
      averageBand: row.average_band !== null ? Math.round(row.average_band * 2) / 2 : null,
      bestBand: row.best_band,
      latestBand: latestBySkill.get(row.skill) ?? null,
      writingScores: 0,
      averageWritingBand: null,
    });
  }

  const writing = bySkill.get('WRITING') ?? {
    skill: 'WRITING' as Skill,
    sessions: 0,
    rawScore: 0,
    totalQuestions: 0,
    accuracy: null,
    averageBand: null,
    bestBand: null,
    latestBand: null,
    writingScores: 0,
    averageWritingBand: null,
  };
  writing.writingScores = writingRows?.scored ?? 0;
  writing.averageWritingBand =
    writingRows?.average_band !== null && writingRows?.average_band !== undefined
      ? Math.round(writingRows.average_band * 2) / 2
      : null;
  bySkill.set('WRITING', writing);

  return [...bySkill.values()];
}

/** Task-type accuracy from already-marked answers (cheap: indexed by attempt). */
export async function getTaskTypePerformance(
  env: Env,
  filters: AnalyticsFilters,
  userId: string | null,
  options: { userIds?: string[]; classroomId?: string } = {},
): Promise<TaskTypePerformance[]> {
  const conditions: string[] = ['aa.marked_at IS NOT NULL'];
  const bindings: unknown[] = [];
  if (userId) {
    conditions.push('a.user_id = ?');
    bindings.push(userId);
  }
  if (options.userIds && options.userIds.length > 0) {
    conditions.push(`a.user_id IN (${options.userIds.map(() => '?').join(',')})`);
    bindings.push(...options.userIds);
  }
  if (options.classroomId) {
    conditions.push('a.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = ?)');
    bindings.push(options.classroomId);
  }
  if (filters.from) {
    conditions.push('a.started_at >= ?');
    bindings.push(filters.from);
  }
  if (filters.to) {
    conditions.push('a.started_at <= ?');
    bindings.push(filters.to);
  }
  if (filters.testType) {
    conditions.push('a.test_type = ?');
    bindings.push(filters.testType);
  }

  const rows = await env.DB.prepare(
    `SELECT g.question_type,
            COUNT(*) AS answered,
            SUM(CASE WHEN aa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM attempt_answers aa
       JOIN attempts a ON a.id = aa.attempt_id
       JOIN questions q ON q.id = aa.question_id
       JOIN question_groups g ON g.id = q.question_group_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY g.question_type
      ORDER BY answered DESC`,
  )
    .bind(...bindings)
    .all<{ question_type: string; answered: number; correct: number }>();

  return rows.results.map((row) => ({
    questionType: row.question_type,
    label: isQuestionType(row.question_type) ? QUESTION_TYPE_META[row.question_type].label : row.question_type,
    answered: row.answered,
    correct: row.correct,
    accuracy: row.answered > 0 ? Math.round((row.correct / row.answered) * 1000) / 10 : null,
  }));
}

export async function getTrends(
  env: Env,
  filters: AnalyticsFilters,
  userId: string,
  limit = 40,
): Promise<TrendPoint[]> {
  const conditions: string[] = ["a.user_id = ?", "a.status IN ('SUBMITTED','EXPIRED')", 'a.submitted_at IS NOT NULL'];
  const bindings: unknown[] = [userId];
  if (filters.from) {
    conditions.push('a.started_at >= ?');
    bindings.push(filters.from);
  }
  if (filters.to) {
    conditions.push('a.started_at <= ?');
    bindings.push(filters.to);
  }
  if (filters.testType) {
    conditions.push('a.test_type = ?');
    bindings.push(filters.testType);
  }
  if (filters.skill) {
    conditions.push('EXISTS (SELECT 1 FROM attempt_skill_sessions s2 WHERE s2.attempt_id = a.id AND s2.skill = ?)');
    bindings.push(filters.skill);
  }

  const attempts = await env.DB.prepare(
    `SELECT a.id, a.test_type, a.submitted_at, a.raw_score, a.total_questions, a.estimated_band
       FROM attempts a
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.submitted_at DESC
      LIMIT ?`,
  )
    .bind(...bindings, limit)
    .all<{
      id: string;
      test_type: TestType;
      submitted_at: string;
      raw_score: number | null;
      total_questions: number | null;
      estimated_band: number | null;
    }>();

  if (attempts.results.length === 0) return [];

  const ids = attempts.results.map((row) => row.id);
  const sessions = await env.DB.prepare(
    `SELECT attempt_id, skill, raw_score, total_questions, estimated_band
       FROM attempt_skill_sessions
      WHERE attempt_id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{
      attempt_id: string;
      skill: Skill;
      raw_score: number | null;
      total_questions: number | null;
      estimated_band: number | null;
    }>();

  const byAttempt = new Map<string, TrendPoint['skills']>();
  for (const row of sessions.results) {
    const list = byAttempt.get(row.attempt_id) ?? [];
    if (row.skill !== 'WRITING' || (row.total_questions ?? 0) > 0 || row.estimated_band !== null) {
      list.push({
        skill: row.skill,
        rawScore: row.raw_score ?? 0,
        totalQuestions: row.total_questions ?? 0,
        band: row.estimated_band,
      });
    }
    byAttempt.set(row.attempt_id, list);
  }

  return attempts.results.map((row) => ({
    date: row.submitted_at,
    attemptId: row.id,
    testType: row.test_type,
    skills: byAttempt.get(row.id) ?? [],
    rawScore: row.raw_score,
    totalQuestions: row.total_questions,
    estimatedBand: row.estimated_band,
  }));
}

// -----------------------------------------------------------------------------
// 41. Section analytics — performance by Reading passage / Listening part,
// writing-task completion, time spent and unanswered counts per section.
// Aggregates only; a passage/part score is never presented as a standalone
// IELTS band.
// -----------------------------------------------------------------------------
export interface SectionPerformance {
  sectionId: string;
  label: string;
  title: string;
  skill: Skill;
  type: string;
  /** Distinct submitted attempts that contain this section. */
  attempts: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  /** Sum over attempts of (questions in section − answered). */
  unanswered: number;
  /** Mean seconds spent in the section per attempt, when part timers ran. */
  averageSeconds: number | null;
}

export async function getSectionPerformance(
  env: Env,
  filters: AnalyticsFilters,
  userId: string | null,
  options: { classroomId?: string; userIds?: string[] } = {},
): Promise<SectionPerformance[]> {
  const conditions: string[] = ["a.status IN ('SUBMITTED','EXPIRED')"];
  const bindings: unknown[] = [];
  if (userId) {
    conditions.push('a.user_id = ?');
    bindings.push(userId);
  }
  if (options.userIds && options.userIds.length > 0) {
    conditions.push(`a.user_id IN (${options.userIds.map(() => '?').join(',')})`);
    bindings.push(...options.userIds);
  }
  if (options.classroomId) {
    conditions.push('a.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = ?)');
    bindings.push(options.classroomId);
  }
  if (filters.from) {
    conditions.push('a.started_at >= ?');
    bindings.push(filters.from);
  }
  if (filters.to) {
    conditions.push('a.started_at <= ?');
    bindings.push(filters.to);
  }
  if (filters.skill) {
    conditions.push('sec.skill = ?');
    bindings.push(filters.skill);
  }

  const rows = await env.DB.prepare(
    `SELECT sec.id AS section_id, sec.title, sec.label, sec.skill,
            COALESCE(sec.type, CASE sec.skill WHEN 'READING' THEN 'READING_PASSAGE' WHEN 'LISTENING' THEN 'LISTENING_PART' ELSE 'WRITING_TASK' END) AS type,
            sec.order_index,
            (SELECT COUNT(*) FROM questions q WHERE q.section_id = sec.id) AS total_questions,
            COUNT(DISTINCT a.id) AS attempts,
            SUM(CASE WHEN aa.answer_json IS NOT NULL AND aa.answer_json != '' AND aa.answer_json != 'null' THEN 1 ELSE 0 END) AS answered,
            SUM(CASE WHEN aa.is_correct = 1 THEN 1 ELSE 0 END) AS correct
       FROM sections sec
       JOIN attempts a ON a.test_version_id = sec.test_version_id
       LEFT JOIN questions q ON q.section_id = sec.id
       LEFT JOIN attempt_answers aa ON aa.question_id = q.id AND aa.attempt_id = a.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY sec.id
      ORDER BY a.test_version_id, sec.order_index`,
  )
    .bind(...bindings)
    .all<{
      section_id: string;
      title: string;
      label: string;
      skill: Skill;
      type: string;
      order_index: number;
      total_questions: number;
      attempts: number;
      answered: number | null;
      correct: number | null;
    }>();

  // Time spent per section comes from the server-tracked part timers.
  const timeRows = await env.DB.prepare(
    `SELECT sec.id AS section_id, AVG(
        CAST(julianday(COALESCE(asec.submitted_at, asec.deadline_at)) - julianday(asec.started_at) AS REAL) * 86400
     ) AS average_seconds
       FROM attempt_sections asec
       JOIN attempts a ON a.id = asec.attempt_id
       JOIN sections sec ON sec.id = asec.section_id
      WHERE asec.started_at IS NOT NULL
        AND a.status IN ('SUBMITTED','EXPIRED')
        ${userId ? 'AND a.user_id = ?' : ''}
      GROUP BY sec.id`,
  )
    .bind(...(userId ? [userId] : []))
    .all<{ section_id: string; average_seconds: number | null }>();
  const timeBySection = new Map(timeRows.results.map((row) => [row.section_id, row.average_seconds]));

  return rows.results
    .filter((row) => row.attempts > 0)
    .map((row) => {
      const attempts = row.attempts;
      const answered = row.answered ?? 0;
      const correct = row.correct ?? 0;
      const totalSlots = row.total_questions * attempts;
      const averageSeconds = timeBySection.get(row.section_id) ?? null;
      return {
        sectionId: row.section_id,
        label: sectionDisplayLabel({ label: row.label, type: row.type, skill: row.skill, orderIndex: row.order_index, title: row.title }),
        title: row.title,
        skill: row.skill,
        type: row.type,
        attempts,
        answered,
        correct,
        accuracy: answered > 0 ? Math.round((correct / answered) * 1000) / 10 : null,
        unanswered: Math.max(0, totalSlots - answered),
        averageSeconds: averageSeconds !== null && Number.isFinite(averageSeconds) ? Math.round(averageSeconds) : null,
      } satisfies SectionPerformance;
    });
}

export interface StudentDashboard {
  assignments: AssignmentSummary[];
  upcomingDeadlines: AssignmentSummary[];
  recentAttempts: AttemptSummary[];
  sectionPerformance: SectionPerformance[];
  skillPerformance: SkillPerformance[];
  taskTypes: TaskTypePerformance[];
  trends: TrendPoint[];
  mockHistory: AttemptSummary[];
  practiceHistory: AttemptSummary[];
  totals: { attempts: number; submitted: number; inProgress: number; fullMocks: number };
}

export async function getStudentDashboard(
  env: Env,
  userId: string,
  filters: AnalyticsFilters,
): Promise<StudentDashboard> {
  const [assignments, attempts, skillPerformance, taskTypes, trends, sectionPerformance] = await Promise.all([
    listStudentAssignments(env, userId),
    listAttempts(env, userId, { ...filters, limit: filters.limit ?? 60 }),
    getSkillPerformance(env, filters, userId),
    getTaskTypePerformance(env, filters, userId),
    getTrends(env, filters, userId),
    getSectionPerformance(env, filters, userId),
  ]);

  const upcomingDeadlines = assignments
    .filter((assignment) => assignment.deadlineAt && assignment.status !== 'SUBMITTED')
    .sort((a, b) => new Date(a.deadlineAt!).getTime() - new Date(b.deadlineAt!).getTime())
    .slice(0, 6);

  const counts = await env.DB.prepare(
    `SELECT
        COUNT(*) AS attempts,
        SUM(CASE WHEN status IN ('SUBMITTED','EXPIRED') THEN 1 ELSE 0 END) AS submitted,
        SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN test_type = 'FULL_MOCK' AND status IN ('SUBMITTED','EXPIRED') THEN 1 ELSE 0 END) AS full_mocks
       FROM attempts WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ attempts: number; submitted: number | null; in_progress: number | null; full_mocks: number | null }>();

  const mockHistory = await listAttempts(env, userId, { ...filters, testType: 'FULL_MOCK', limit: 25 });
  const practiceHistory = attempts.filter((attempt) => attempt.testType !== 'FULL_MOCK');

  return {
    assignments,
    upcomingDeadlines,
    recentAttempts: attempts.filter((attempt) => attempt.submittedAt).slice(0, 8),
    skillPerformance,
    sectionPerformance,
    taskTypes,
    trends,
    mockHistory,
    practiceHistory,
    totals: {
      attempts: counts?.attempts ?? 0,
      submitted: counts?.submitted ?? 0,
      inProgress: counts?.in_progress ?? 0,
      fullMocks: counts?.full_mocks ?? 0,
    },
  };
}

// -----------------------------------------------------------------------------
// Teacher / admin analytics
// -----------------------------------------------------------------------------
export interface ClassroomAnalytics {
  classroomId: string;
  studentCount: number;
  assignmentCount: number;
  assignments: Array<{
    assignmentId: string;
    title: string;
    testTitle: string;
    testType: TestType;
    versionNumber: number;
    deadlineAt: string | null;
    assignedCount: number;
    startedCount: number;
    submittedCount: number;
    averageRawScore: number | null;
    averageTotalQuestions: number | null;
    averageBand: number | null;
    integrityFlaggedAttempts: number;
  }>;
  skillPerformance: SkillPerformance[];
  sectionPerformance: SectionPerformance[];
  taskTypes: TaskTypePerformance[];
  bandDistribution: Array<{ band: number; count: number }>;
  integritySummary: Array<{ type: string; count: number }>;
}

export async function getClassroomAnalytics(env: Env, classroomId: string): Promise<ClassroomAnalytics> {
  const studentCount = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM classroom_members WHERE classroom_id = ? AND status = 'ACTIVE' AND role = 'STUDENT'`,
  )
    .bind(classroomId)
    .first<{ count: number }>();

  const assignmentRows = await env.DB.prepare(
    `SELECT a.id, a.title, t.title AS test_title, t.type AS test_type, v.version_number, a.deadline_at,
            (SELECT COUNT(*) FROM classroom_members m WHERE m.classroom_id = a.classroom_id AND m.status = 'ACTIVE' AND m.role = 'STUDENT') AS assigned_count,
            (SELECT COUNT(DISTINCT x.user_id) FROM attempts x WHERE x.assignment_id = a.id AND x.status != 'ABANDONED') AS started_count,
            (SELECT COUNT(DISTINCT x.user_id) FROM attempts x WHERE x.assignment_id = a.id AND x.status IN ('SUBMITTED','EXPIRED')) AS submitted_count,
            (SELECT AVG(x.raw_score) FROM attempts x WHERE x.assignment_id = a.id AND x.status IN ('SUBMITTED','EXPIRED')) AS avg_raw,
            (SELECT AVG(x.total_questions) FROM attempts x WHERE x.assignment_id = a.id AND x.status IN ('SUBMITTED','EXPIRED')) AS avg_total,
            (SELECT AVG(x.estimated_band) FROM attempts x WHERE x.assignment_id = a.id AND x.estimated_band IS NOT NULL) AS avg_band,
            (SELECT COUNT(DISTINCT x.id) FROM attempts x JOIN integrity_events e ON e.attempt_id = x.id
              WHERE x.assignment_id = a.id AND e.type IN ('TAB_HIDDEN','FULLSCREEN_EXIT','COPY_ATTEMPT','PASTE_ATTEMPT')) AS flagged_attempts
       FROM assignments a
       JOIN tests t ON t.id = a.test_id
       JOIN test_versions v ON v.id = a.test_version_id
      WHERE a.classroom_id = ? AND a.status != 'ARCHIVED'
      ORDER BY a.created_at DESC`,
  )
    .bind(classroomId)
    .all<{
      id: string;
      title: string;
      test_title: string;
      test_type: TestType;
      version_number: number;
      deadline_at: string | null;
      assigned_count: number;
      started_count: number;
      submitted_count: number;
      avg_raw: number | null;
      avg_total: number | null;
      avg_band: number | null;
      flagged_attempts: number;
    }>();

  const [skillPerformance, sectionPerformance, taskTypes, bandDist, integrity] = await Promise.all([
    getSkillPerformance(env, {}, null, { classroomId }),
    getSectionPerformance(env, {}, null, { classroomId }),
    getTaskTypePerformance(env, {}, null, { classroomId }),
    env.DB.prepare(
      `SELECT s.estimated_band AS band, COUNT(*) AS count
         FROM attempt_skill_sessions s
         JOIN attempts a ON a.id = s.attempt_id
         JOIN assignments asg ON asg.id = a.assignment_id
        WHERE asg.classroom_id = ? AND s.estimated_band IS NOT NULL
        GROUP BY s.estimated_band ORDER BY s.estimated_band`,
    )
      .bind(classroomId)
      .all<{ band: number; count: number }>(),
    env.DB.prepare(
      `SELECT e.type, COUNT(*) AS count
         FROM integrity_events e
         JOIN attempts a ON a.id = e.attempt_id
         JOIN assignments asg ON asg.id = a.assignment_id
        WHERE asg.classroom_id = ?
        GROUP BY e.type ORDER BY count DESC`,
    )
      .bind(classroomId)
      .all<{ type: string; count: number }>(),
  ]);

  return {
    classroomId,
    studentCount: studentCount?.count ?? 0,
    assignmentCount: assignmentRows.results.length,
    assignments: assignmentRows.results.map((row) => ({
      assignmentId: row.id,
      title: row.title,
      testTitle: row.test_title,
      testType: row.test_type,
      versionNumber: row.version_number,
      deadlineAt: row.deadline_at,
      assignedCount: row.assigned_count,
      startedCount: row.started_count,
      submittedCount: row.submitted_count,
      averageRawScore: row.avg_raw !== null ? Math.round(row.avg_raw * 10) / 10 : null,
      averageTotalQuestions: row.avg_total !== null ? Math.round(row.avg_total) : null,
      averageBand: row.avg_band !== null ? Math.round(row.avg_band * 2) / 2 : null,
      integrityFlaggedAttempts: row.flagged_attempts,
    })),
    skillPerformance,
    sectionPerformance,
    taskTypes,
    bandDistribution: bandDist.results,
    integritySummary: integrity.results,
  };
}

export interface AdminAnalytics {
  users: { total: number; students: number; teachers: number; admins: number; activeLast30Days: number };
  tests: { total: number; draft: number; review: number; published: number; archived: number };
  attempts: { total: number; submitted: number; inProgress: number; last7Days: number; last30Days: number };
  completion: { assignmentAttempts: number; submittedAssignmentAttempts: number; completionRate: number | null };
  imports: { total: number; pending: number; failed: number };
  recentActivity: Array<{ date: string; attempts: number }>;
}

export async function getAdminAnalytics(env: Env): Promise<AdminAnalytics> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const [users, tests, attempts, completion, imports, activity] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role = 'STUDENT' THEN 1 ELSE 0 END) AS students,
              SUM(CASE WHEN role = 'TEACHER' THEN 1 ELSE 0 END) AS teachers,
              SUM(CASE WHEN role = 'ADMIN' THEN 1 ELSE 0 END) AS admins,
              SUM(CASE WHEN last_login_at >= ? THEN 1 ELSE 0 END) AS active30
         FROM users`,
    )
      .bind(iso(now - 30 * 86_400_000))
      .first<{ total: number; students: number; teachers: number; admins: number; active30: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft,
              SUM(CASE WHEN status = 'REVIEW' THEN 1 ELSE 0 END) AS review,
              SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published,
              SUM(CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived
         FROM tests`,
    ).first<{ total: number; draft: number; review: number; published: number; archived: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'SUBMITTED' THEN 1 ELSE 0 END) AS submitted,
              SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress,
              SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS last7,
              SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS last30
         FROM attempts`,
    )
      .bind(iso(now - 7 * 86_400_000), iso(now - 30 * 86_400_000))
      .first<{ total: number; submitted: number; in_progress: number; last7: number; last30: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('SUBMITTED','EXPIRED') THEN 1 ELSE 0 END) AS submitted
         FROM attempts WHERE assignment_id IS NOT NULL`,
    ).first<{ total: number; submitted: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('UPLOADED','PROCESSING','AI_STRUCTURED','REVIEW') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
         FROM imports`,
    ).first<{ total: number; pending: number; failed: number }>(),
    env.DB.prepare(
      `SELECT substr(started_at, 1, 10) AS date, COUNT(*) AS attempts
         FROM attempts WHERE started_at >= ?
        GROUP BY date ORDER BY date`,
    )
      .bind(iso(now - 30 * 86_400_000))
      .all<{ date: string; attempts: number }>(),
  ]);

  return {
    users: {
      total: users?.total ?? 0,
      students: users?.students ?? 0,
      teachers: users?.teachers ?? 0,
      admins: users?.admins ?? 0,
      activeLast30Days: users?.active30 ?? 0,
    },
    tests: {
      total: tests?.total ?? 0,
      draft: tests?.draft ?? 0,
      review: tests?.review ?? 0,
      published: tests?.published ?? 0,
      archived: tests?.archived ?? 0,
    },
    attempts: {
      total: attempts?.total ?? 0,
      submitted: attempts?.submitted ?? 0,
      inProgress: attempts?.in_progress ?? 0,
      last7Days: attempts?.last7 ?? 0,
      last30Days: attempts?.last30 ?? 0,
    },
    completion: {
      assignmentAttempts: completion?.total ?? 0,
      submittedAssignmentAttempts: completion?.submitted ?? 0,
      completionRate:
        completion && completion.total > 0
          ? Math.round(((completion.submitted ?? 0) / completion.total) * 1000) / 10
          : null,
    },
    imports: { total: imports?.total ?? 0, pending: imports?.pending ?? 0, failed: imports?.failed ?? 0 },
    recentActivity: activity.results,
  };
}
