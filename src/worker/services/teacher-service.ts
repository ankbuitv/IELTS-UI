import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import { randomToken, hashSessionToken } from '../lib/crypto';
import type { AuthUser } from '../lib/auth-types';
import type { ExamMode, ResultVisibility, TestType } from '../../shared/types';
import { resolvePolicy, type IntegrityPolicy } from '../../shared/integrity';

export interface ClassroomView {
  id: string;
  name: string;
  description: string;
  joinCode: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  studentCount: number;
  assignmentCount: number;
  isOwner: boolean;
}

/**
 * Every classroom read/write goes through this check. Teachers can only reach
 * classrooms they own or co-teach; changing an id in a URL cannot widen access.
 */
export async function requireClassroomAccess(
  env: Env,
  user: AuthUser,
  classroomId: string,
  options: { requireOwner?: boolean } = {},
): Promise<{ id: string; teacher_id: string; name: string; status: string }> {
  const classroom = await env.DB.prepare('SELECT id, teacher_id, name, status FROM classrooms WHERE id = ?')
    .bind(classroomId)
    .first<{ id: string; teacher_id: string; name: string; status: string }>();
  if (!classroom) throw ApiError.notFound('Classroom not found.');

  if (user.role === 'ADMIN') return classroom;

  if (classroom.teacher_id === user.id) return classroom;

  if (!options.requireOwner) {
    const coTeacher = await env.DB.prepare(
      `SELECT id FROM classroom_members
        WHERE classroom_id = ? AND user_id = ? AND role = 'CO_TEACHER' AND status = 'ACTIVE'`,
    )
      .bind(classroomId, user.id)
      .first<{ id: string }>();
    if (coTeacher) return classroom;
  }

  throw ApiError.forbidden('You are not authorized to manage this classroom.');
}

export async function listClassroomsForTeacher(env: Env, user: AuthUser): Promise<ClassroomView[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id, c.name, c.description, c.join_code, c.status, c.created_at, c.teacher_id,
            (SELECT COUNT(*) FROM classroom_members m WHERE m.classroom_id = c.id AND m.status = 'ACTIVE' AND m.role = 'STUDENT') AS student_count,
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id AND a.status != 'ARCHIVED') AS assignment_count
       FROM classrooms c
      WHERE c.teacher_id = ?
         OR EXISTS (SELECT 1 FROM classroom_members m2
                     WHERE m2.classroom_id = c.id AND m2.user_id = ? AND m2.role = 'CO_TEACHER' AND m2.status = 'ACTIVE')
      ORDER BY (c.status = 'ARCHIVED'), c.created_at DESC`,
  )
    .bind(user.id, user.id)
    .all<{
      id: string;
      name: string;
      description: string;
      join_code: string;
      status: 'ACTIVE' | 'ARCHIVED';
      created_at: string;
      teacher_id: string;
      student_count: number;
      assignment_count: number;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    joinCode: row.join_code,
    status: row.status,
    createdAt: row.created_at,
    studentCount: row.student_count,
    assignmentCount: row.assignment_count,
    isOwner: row.teacher_id === user.id,
  }));
}

export async function createClassroom(
  env: Env,
  user: AuthUser,
  input: { name: string; description?: string },
): Promise<ClassroomView> {
  const id = newId('cls');
  const timestamp = nowIso();
  const joinCode = await uniqueJoinCode(env);

  await env.DB.prepare(
    `INSERT INTO classrooms (id, name, description, teacher_id, join_code, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
  )
    .bind(id, input.name.trim(), (input.description ?? '').trim(), user.id, joinCode, timestamp, timestamp)
    .run();

  return {
    id,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    joinCode,
    status: 'ACTIVE',
    createdAt: timestamp,
    studentCount: 0,
    assignmentCount: 0,
    isOwner: true,
  };
}

async function uniqueJoinCode(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomToken(5).replace(/[-_]/g, 'x').slice(0, 6).toUpperCase();
    const existing = await env.DB.prepare('SELECT id FROM classrooms WHERE join_code = ?').bind(code).first<{ id: string }>();
    if (!existing) return code;
  }
  throw new Error('Unable to allocate a unique classroom code.');
}

export async function updateClassroom(
  env: Env,
  user: AuthUser,
  classroomId: string,
  input: { name?: string; description?: string; status?: 'ACTIVE' | 'ARCHIVED' },
): Promise<void> {
  const classroom = await requireClassroomAccess(env, user, classroomId);
  const statements: D1PreparedStatement[] = [];
  const timestamp = nowIso();

  if (input.name !== undefined || input.description !== undefined) {
    statements.push(
      env.DB.prepare('UPDATE classrooms SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?')
        .bind(input.name?.trim() ?? null, input.description?.trim() ?? null, timestamp, classroom.id),
    );
  }
  if (input.status) {
    statements.push(
      env.DB.prepare('UPDATE classrooms SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?')
        .bind(input.status, input.status === 'ARCHIVED' ? timestamp : null, timestamp, classroom.id),
    );
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

export interface MemberView {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  joinedAt: string;
  attemptCount: number;
  lastActiveAt: string | null;
}

export async function listClassroomMembers(env: Env, classroomId: string): Promise<MemberView[]> {
  const rows = await env.DB.prepare(
    `SELECT m.user_id, m.role, m.status, m.joined_at, u.email, p.display_name,
            (SELECT COUNT(*) FROM attempts x WHERE x.user_id = m.user_id
               AND x.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = m.classroom_id)) AS attempt_count,
            (SELECT MAX(x.submitted_at) FROM attempts x WHERE x.user_id = m.user_id
               AND x.assignment_id IN (SELECT id FROM assignments WHERE classroom_id = m.classroom_id)) AS last_active
       FROM classroom_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.classroom_id = ?
      ORDER BY m.role, p.display_name, u.email`,
  )
    .bind(classroomId)
    .all<{
      user_id: string;
      role: string;
      status: string;
      joined_at: string;
      email: string;
      display_name: string | null;
      attempt_count: number;
      last_active: string | null;
    }>();

  return rows.results.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? row.email,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    attemptCount: row.attempt_count,
    lastActiveAt: row.last_active,
  }));
}

export interface InviteResult {
  inviteId: string;
  token: string;
  expiresAt: string;
  email: string | null;
}

/** Secure enrolment: a single-use, expiring, hashed token (optionally email-bound). */
export async function createClassroomInvite(
  env: Env,
  user: AuthUser,
  classroomId: string,
  input: { email?: string | null; ttlHours?: number },
): Promise<InviteResult> {
  await requireClassroomAccess(env, user, classroomId);

  const email = input.email ? input.email.trim().toLowerCase() : null;
  if (email) {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
    if (existing) {
      const alreadyMember = await env.DB.prepare(
        `SELECT id FROM classroom_members WHERE classroom_id = ? AND user_id = ? AND status = 'ACTIVE'`,
      )
        .bind(classroomId, existing.id)
        .first<{ id: string }>();
      if (alreadyMember) throw ApiError.conflict('That student is already enrolled in this classroom.');
    }
  }

  const token = randomToken(24);
  const tokenHash = await hashSessionToken(token, env.SESSION_SECRET ?? 'dev-pepper');
  const id = newId('inv');
  const timestamp = nowIso();
  const ttlHours = Math.min(Math.max(input.ttlHours ?? 168, 1), 720);
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

  await env.DB.prepare(
    `INSERT INTO classroom_invites (id, classroom_id, email, token_hash, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, classroomId, email, tokenHash, user.id, expiresAt, timestamp)
    .run();

  return { inviteId: id, token, expiresAt, email };
}

export async function acceptClassroomInvite(
  env: Env,
  user: AuthUser,
  token: string,
): Promise<{ classroomId: string; classroomName: string }> {
  const tokenHash = await hashSessionToken(token, env.SESSION_SECRET ?? 'dev-pepper');
  const invite = await env.DB.prepare(
    `SELECT i.id, i.classroom_id, i.email, i.expires_at, i.accepted_at, i.revoked_at, c.name AS classroom_name, c.status
       FROM classroom_invites i JOIN classrooms c ON c.id = i.classroom_id
      WHERE i.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      classroom_id: string;
      email: string | null;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      classroom_name: string;
      status: string;
    }>();

  if (!invite) throw ApiError.notFound('This invitation link is not valid.');
  if (invite.revoked_at) throw ApiError.forbidden('This invitation has been revoked.');
  if (invite.accepted_at) throw ApiError.conflict('This invitation has already been used.');
  if (new Date(invite.expires_at).getTime() < Date.now()) throw ApiError.forbidden('This invitation has expired.');
  if (invite.status === 'ARCHIVED') throw ApiError.forbidden('That classroom has been archived.');
  if (invite.email && invite.email !== user.email.toLowerCase()) {
    throw ApiError.forbidden('This invitation was issued to a different email address.');
  }

  await enrollMember(env, invite.classroom_id, user.id, user.id);
  await env.DB.prepare('UPDATE classroom_invites SET accepted_at = ?, accepted_by = ? WHERE id = ?')
    .bind(nowIso(), user.id, invite.id)
    .run();

  return { classroomId: invite.classroom_id, classroomName: invite.classroom_name };
}

export async function joinClassroomByCode(
  env: Env,
  user: AuthUser,
  code: string,
): Promise<{ classroomId: string; classroomName: string }> {
  const classroom = await env.DB.prepare('SELECT id, name, status FROM classrooms WHERE join_code = ?')
    .bind(code.trim().toUpperCase())
    .first<{ id: string; name: string; status: string }>();
  if (!classroom) throw ApiError.notFound('No classroom matches that code.');
  if (classroom.status === 'ARCHIVED') throw ApiError.forbidden('That classroom has been archived.');

  await enrollMember(env, classroom.id, user.id, user.id);
  return { classroomId: classroom.id, classroomName: classroom.name };
}

export async function enrollMember(
  env: Env,
  classroomId: string,
  userId: string,
  invitedBy: string,
): Promise<void> {
  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO classroom_members (id, classroom_id, user_id, role, status, invited_by, joined_at, updated_at)
     VALUES (?, ?, ?, 'STUDENT', 'ACTIVE', ?, ?, ?)
     ON CONFLICT (classroom_id, user_id)
     DO UPDATE SET status = 'ACTIVE', updated_at = excluded.updated_at`,
  )
    .bind(newId('mem'), classroomId, userId, invitedBy, timestamp, timestamp)
    .run();
}

export async function addMemberByEmail(
  env: Env,
  user: AuthUser,
  classroomId: string,
  email: string,
): Promise<MemberView> {
  await requireClassroomAccess(env, user, classroomId);
  const student = await env.DB.prepare(
    'SELECT u.id, u.email, u.role, u.status, p.display_name FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.email = ?',
  )
    .bind(email.trim().toLowerCase())
    .first<{ id: string; email: string; role: string; status: string; display_name: string | null }>();

  if (!student) {
    throw ApiError.notFound(
      'No account uses that email yet. Share an invitation link instead so the student can register.',
    );
  }
  if (student.role === 'ADMIN') throw ApiError.forbidden('Administrator accounts cannot be enrolled as students.');

  await enrollMember(env, classroomId, student.id, user.id);

  return {
    userId: student.id,
    email: student.email,
    displayName: student.display_name ?? student.email,
    role: 'STUDENT',
    status: 'ACTIVE',
    joinedAt: nowIso(),
    attemptCount: 0,
    lastActiveAt: null,
  };
}

export async function removeMember(
  env: Env,
  user: AuthUser,
  classroomId: string,
  userId: string,
): Promise<void> {
  const classroom = await requireClassroomAccess(env, user, classroomId);
  if (classroom.teacher_id === userId) {
    throw ApiError.conflict('The classroom owner cannot be removed.');
  }
  await env.DB.prepare(
    `UPDATE classroom_members SET status = 'REMOVED', updated_at = ?
      WHERE classroom_id = ? AND user_id = ?`,
  )
    .bind(nowIso(), classroomId, userId)
    .run();

  // Revoke any outstanding invitation for that address.
  await env.DB.prepare(
    `UPDATE classroom_invites SET revoked_at = ?
      WHERE classroom_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
        AND email = (SELECT email FROM users WHERE id = ?)`,
  )
    .bind(nowIso(), classroomId, userId)
    .run();
}

export async function revokeInvite(env: Env, user: AuthUser, classroomId: string, inviteId: string): Promise<void> {
  await requireClassroomAccess(env, user, classroomId);
  await env.DB.prepare('UPDATE classroom_invites SET revoked_at = ? WHERE id = ? AND classroom_id = ?')
    .bind(nowIso(), inviteId, classroomId)
    .run();
}

export async function listInvites(env: Env, classroomId: string) {
  const rows = await env.DB.prepare(
    `SELECT i.id, i.email, i.expires_at, i.accepted_at, i.revoked_at, i.created_at, u.email AS invited_by_email
       FROM classroom_invites i JOIN users u ON u.id = i.invited_by
      WHERE i.classroom_id = ?
      ORDER BY i.created_at DESC LIMIT 50`,
  )
    .bind(classroomId)
    .all<{
      id: string;
      email: string | null;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      created_at: string;
      invited_by_email: string;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    email: row.email,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    invitedBy: row.invited_by_email,
    status: row.revoked_at ? 'REVOKED' : row.accepted_at ? 'ACCEPTED' : new Date(row.expires_at).getTime() < Date.now() ? 'EXPIRED' : 'PENDING',
  }));
}

// -----------------------------------------------------------------------------
// Assignments
// -----------------------------------------------------------------------------
export interface AssignmentInput {
  classroomId: string;
  testVersionId: string;
  title?: string;
  instructions?: string;
  startAt?: string | null;
  deadlineAt?: string | null;
  maxAttempts?: number;
  timingPolicy?: 'EXAM_DURATION' | 'UNTIMED' | 'CUSTOM';
  customDurationSeconds?: number | null;
  mode?: ExamMode;
  integrityOverrides?: Partial<IntegrityPolicy> | null;
  resultVisibility?: ResultVisibility;
  publish?: boolean;
}

export const INTEGRITY_OVERRIDE_KEYS = [
  'requireFullscreen',
  'monitorVisibility',
  'maxTabAwayEvents',
  'maxFullscreenExits',
  'allowCopy',
  'allowPaste',
  'allowContextMenu',
  'warnAtEvents',
  'autoSubmitAtEvents',
  'allowResume',
  'showIndicator',
] as const;

export function sanitiseIntegrityOverrides(input: unknown): Partial<IntegrityPolicy> {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const out: Partial<IntegrityPolicy> = {};
  for (const key of INTEGRITY_OVERRIDE_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      (out as Record<string, unknown>)[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      (out as Record<string, unknown>)[key] = Math.max(0, Math.min(100, Math.floor(value)));
    } else if (value === null && (key === 'maxTabAwayEvents' || key === 'maxFullscreenExits' || key === 'warnAtEvents' || key === 'autoSubmitAtEvents')) {
      (out as Record<string, unknown>)[key] = null;
    }
  }
  return out;
}

export async function createAssignment(
  env: Env,
  user: AuthUser,
  input: AssignmentInput,
): Promise<{ assignmentId: string }> {
  await requireClassroomAccess(env, user, input.classroomId);

  const version = await env.DB.prepare(
    `SELECT v.id, v.status, v.test_id, t.title AS test_title, t.status AS test_status
       FROM test_versions v JOIN tests t ON t.id = v.test_id WHERE v.id = ?`,
  )
    .bind(input.testVersionId)
    .first<{ id: string; status: string; test_id: string; test_title: string; test_status: string }>();

  if (!version) throw ApiError.notFound('Test version not found.');
  if (version.status !== 'PUBLISHED') {
    throw ApiError.validation('Only a published test version can be assigned.');
  }
  if (version.test_status === 'ARCHIVED') {
    throw ApiError.validation('That test has been archived.');
  }

  if (input.startAt && input.deadlineAt && new Date(input.startAt).getTime() >= new Date(input.deadlineAt).getTime()) {
    throw ApiError.validation('The deadline must be after the start date.');
  }

  const id = newId('asg');
  const timestamp = nowIso();
  const mode: ExamMode = input.mode ?? 'STANDARD_EXAM';

  await env.DB.prepare(
    `INSERT INTO assignments (id, classroom_id, teacher_id, test_id, test_version_id, title, instructions,
                              start_at, deadline_at, max_attempts, timing_policy, custom_duration_seconds, mode,
                              integrity_policy_json, result_visibility, allow_reattempt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      input.classroomId,
      user.id,
      version.test_id,
      version.id,
      (input.title?.trim() || version.test_title).slice(0, 200),
      (input.instructions ?? '').slice(0, 4000),
      input.startAt ?? null,
      input.deadlineAt ?? null,
      Math.min(Math.max(input.maxAttempts ?? 1, 1), 20),
      input.timingPolicy ?? 'EXAM_DURATION',
      input.customDurationSeconds ?? null,
      mode,
      JSON.stringify(sanitiseIntegrityOverrides(input.integrityOverrides)),
      input.resultVisibility ?? 'AFTER_DEADLINE',
      input.publish === false ? 'DRAFT' : 'ACTIVE',
      timestamp,
      timestamp,
    )
    .run();

  return { assignmentId: id };
}

export async function updateAssignment(
  env: Env,
  user: AuthUser,
  assignmentId: string,
  input: Partial<Omit<AssignmentInput, 'classroomId' | 'testVersionId'>>,
): Promise<void> {
  const assignment = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?')
    .bind(assignmentId)
    .first<{
      id: string;
      classroom_id: string;
      teacher_id: string;
      start_at: string | null;
      deadline_at: string | null;
      status: string;
    }>();
  if (!assignment) throw ApiError.notFound('Assignment not found.');

  const classroom = await requireClassroomAccess(env, user, assignment.classroom_id);
  if (classroom.teacher_id !== user.id && user.role !== 'ADMIN') {
    throw ApiError.forbidden('Only the classroom owner can change an assignment.');
  }

  const startAt = input.startAt === undefined ? assignment.start_at : input.startAt;
  const deadlineAt = input.deadlineAt === undefined ? assignment.deadline_at : input.deadlineAt;
  if (startAt && deadlineAt && new Date(startAt).getTime() >= new Date(deadlineAt).getTime()) {
    throw ApiError.validation('The deadline must be after the start date.');
  }

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE assignments
        SET title = COALESCE(?, title),
            instructions = COALESCE(?, instructions),
            start_at = ?,
            deadline_at = ?,
            max_attempts = COALESCE(?, max_attempts),
            timing_policy = COALESCE(?, timing_policy),
            custom_duration_seconds = ?,
            mode = COALESCE(?, mode),
            integrity_policy_json = COALESCE(?, integrity_policy_json),
            result_visibility = COALESCE(?, result_visibility),
            status = COALESCE(?, status),
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      input.title?.trim() ?? null,
      input.instructions ?? null,
      startAt ?? null,
      deadlineAt ?? null,
      input.maxAttempts !== undefined ? Math.min(Math.max(input.maxAttempts, 1), 20) : null,
      input.timingPolicy ?? null,
      input.customDurationSeconds ?? null,
      input.mode ?? null,
      input.integrityOverrides !== undefined ? JSON.stringify(sanitiseIntegrityOverrides(input.integrityOverrides)) : null,
      input.resultVisibility ?? null,
      input.publish === undefined ? null : input.publish ? 'ACTIVE' : 'DRAFT',
      timestamp,
      assignmentId,
    )
    .run();
}

export async function archiveAssignment(env: Env, user: AuthUser, assignmentId: string): Promise<void> {
  const assignment = await env.DB.prepare('SELECT classroom_id FROM assignments WHERE id = ?')
    .bind(assignmentId)
    .first<{ classroom_id: string }>();
  if (!assignment) throw ApiError.notFound('Assignment not found.');
  await requireClassroomAccess(env, user, assignment.classroom_id);
  await env.DB.prepare(`UPDATE assignments SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), assignmentId)
    .run();
}

export interface AssignmentDetail {
  id: string;
  classroomId: string;
  classroomName: string;
  title: string;
  instructions: string;
  testId: string;
  testTitle: string;
  testType: TestType;
  testVersionId: string;
  versionNumber: number;
  startAt: string | null;
  deadlineAt: string | null;
  maxAttempts: number;
  timingPolicy: string;
  customDurationSeconds: number | null;
  mode: ExamMode;
  integrityPolicy: IntegrityPolicy;
  resultVisibility: ResultVisibility;
  status: string;
  createdAt: string;
  report: Array<{
    userId: string;
    email: string;
    displayName: string;
    attemptsUsed: number;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'OVERDUE';
    bestRawScore: number | null;
    bestTotalQuestions: number | null;
    bestBand: number | null;
    latestAttemptId: string | null;
    latestSubmittedAt: string | null;
    integrityEventCount: number;
    writingSubmitted: number;
  }>;
}

export async function getAssignmentDetail(
  env: Env,
  user: AuthUser,
  assignmentId: string,
): Promise<AssignmentDetail> {
  const assignment = await env.DB.prepare(
    `SELECT a.*, c.name AS classroom_name, t.title AS test_title, t.type AS test_type, v.version_number
       FROM assignments a
       JOIN classrooms c ON c.id = a.classroom_id
       JOIN tests t ON t.id = a.test_id
       JOIN test_versions v ON v.id = a.test_version_id
      WHERE a.id = ?`,
  )
    .bind(assignmentId)
    .first<{
      id: string;
      classroom_id: string;
      classroom_name: string;
      title: string;
      instructions: string;
      test_id: string;
      test_title: string;
      test_type: TestType;
      test_version_id: string;
      version_number: number;
      start_at: string | null;
      deadline_at: string | null;
      max_attempts: number;
      timing_policy: string;
      custom_duration_seconds: number | null;
      mode: ExamMode;
      integrity_policy_json: string;
      result_visibility: ResultVisibility;
      status: string;
      created_at: string;
    }>();

  if (!assignment) throw ApiError.notFound('Assignment not found.');
  await requireClassroomAccess(env, user, assignment.classroom_id);

  const students = await env.DB.prepare(
    `SELECT m.user_id, u.email, p.display_name,
            (SELECT COUNT(*) FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id AND x.status != 'ABANDONED') AS attempts_used,
            (SELECT MAX(x.raw_score) FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id AND x.status IN ('SUBMITTED','EXPIRED')) AS best_raw,
            (SELECT x.total_questions FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id AND x.status IN ('SUBMITTED','EXPIRED') ORDER BY x.raw_score DESC LIMIT 1) AS best_total,
            (SELECT MAX(x.estimated_band) FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id AND x.estimated_band IS NOT NULL) AS best_band,
            (SELECT x.id FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id ORDER BY x.started_at DESC LIMIT 1) AS latest_attempt_id,
            (SELECT MAX(x.submitted_at) FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id) AS latest_submitted_at,
            (SELECT COUNT(*) FROM integrity_events e JOIN attempts x ON x.id = e.attempt_id
              WHERE x.assignment_id = ? AND x.user_id = m.user_id AND e.type IN ('TAB_HIDDEN','FULLSCREEN_EXIT','COPY_ATTEMPT','PASTE_ATTEMPT')) AS integrity_count,
            (SELECT COUNT(*) FROM writing_submissions w JOIN attempts x ON x.id = w.attempt_id
              WHERE x.assignment_id = ? AND x.user_id = m.user_id AND TRIM(w.response_text) != '') AS writing_count,
            (SELECT COUNT(*) FROM attempts x WHERE x.assignment_id = ? AND x.user_id = m.user_id AND x.status = 'IN_PROGRESS') AS in_progress
       FROM classroom_members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.classroom_id = ? AND m.status = 'ACTIVE' AND m.role = 'STUDENT'
      ORDER BY p.display_name, u.email`,
  )
    .bind(
      assignmentId,
      assignmentId,
      assignmentId,
      assignmentId,
      assignmentId,
      assignmentId,
      assignmentId,
      assignmentId,
      assignmentId,
      assignment.classroom_id,
    )
    .all<{
      user_id: string;
      email: string;
      display_name: string | null;
      attempts_used: number;
      best_raw: number | null;
      best_total: number | null;
      best_band: number | null;
      latest_attempt_id: string | null;
      latest_submitted_at: string | null;
      integrity_count: number;
      writing_count: number;
      in_progress: number;
    }>();

  const now = Date.now();
  const overdue = Boolean(assignment.deadline_at && new Date(assignment.deadline_at).getTime() < now);

  return {
    id: assignment.id,
    classroomId: assignment.classroom_id,
    classroomName: assignment.classroom_name,
    title: assignment.title,
    instructions: assignment.instructions,
    testId: assignment.test_id,
    testTitle: assignment.test_title,
    testType: assignment.test_type,
    testVersionId: assignment.test_version_id,
    versionNumber: assignment.version_number,
    startAt: assignment.start_at,
    deadlineAt: assignment.deadline_at,
    maxAttempts: assignment.max_attempts,
    timingPolicy: assignment.timing_policy,
    customDurationSeconds: assignment.custom_duration_seconds,
    mode: assignment.mode,
    integrityPolicy: resolvePolicy(
      assignment.mode,
      parseJson<Partial<IntegrityPolicy>>(assignment.integrity_policy_json, {}),
    ),
    resultVisibility: assignment.result_visibility,
    status: assignment.status,
    createdAt: assignment.created_at,
    report: students.results.map((row) => {
      let status: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'OVERDUE' = 'NOT_STARTED';
      if (row.in_progress > 0) status = 'IN_PROGRESS';
      else if (row.latest_submitted_at && row.attempts_used >= Math.max(1, assignment.max_attempts)) status = 'SUBMITTED';
      else if (overdue) status = 'OVERDUE';
      else if (row.attempts_used > 0) status = 'IN_PROGRESS';

      return {
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name ?? row.email,
        attemptsUsed: row.attempts_used,
        status,
        bestRawScore: row.best_raw,
        bestTotalQuestions: row.best_total,
        bestBand: row.best_band,
        latestAttemptId: row.latest_attempt_id,
        latestSubmittedAt: row.latest_submitted_at,
        integrityEventCount: row.integrity_count,
        writingSubmitted: row.writing_count,
      };
    }),
  };
}

/**
 * Teacher view of a single student. Access is granted only when the teacher
 * shares at least one classroom with that student (or administers the platform).
 */
export async function requireStudentAccess(env: Env, user: AuthUser, studentUserId: string): Promise<void> {
  if (user.role === 'ADMIN') return;
  if (user.id === studentUserId) return;
  if (user.role !== 'TEACHER') throw ApiError.forbidden('You are not authorized to view this student.');

  const shared = await env.DB.prepare(
    `SELECT 1 AS ok
       FROM classroom_members student
       JOIN classrooms c ON c.id = student.classroom_id
      WHERE student.user_id = ? AND student.status = 'ACTIVE'
        AND (c.teacher_id = ?
             OR EXISTS (SELECT 1 FROM classroom_members ct
                         WHERE ct.classroom_id = c.id AND ct.user_id = ? AND ct.role = 'CO_TEACHER' AND ct.status = 'ACTIVE'))
      LIMIT 1`,
  )
    .bind(studentUserId, user.id, user.id)
    .first<{ ok: number }>();

  if (!shared) throw ApiError.forbidden('You are not authorized to view this student.');
}

export async function listAssignmentsForClassroom(env: Env, classroomId: string) {
  const rows = await env.DB.prepare(
    `SELECT a.id, a.title, a.status, a.mode, a.result_visibility, a.deadline_at, a.start_at, a.max_attempts,
            a.timing_policy, a.custom_duration_seconds, t.title AS test_title, t.type AS test_type, v.version_number,
            (SELECT COUNT(*) FROM attempts x WHERE x.assignment_id = a.id AND x.status IN ('SUBMITTED','EXPIRED')) AS submissions
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
      status: string;
      mode: string;
      result_visibility: string;
      deadline_at: string | null;
      start_at: string | null;
      max_attempts: number;
      timing_policy: string;
      custom_duration_seconds: number | null;
      test_title: string;
      test_type: TestType;
      version_number: number;
      submissions: number;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    mode: row.mode,
    resultVisibility: row.result_visibility,
    deadlineAt: row.deadline_at,
    startAt: row.start_at,
    maxAttempts: row.max_attempts,
    timingPolicy: row.timing_policy,
    customDurationSeconds: row.custom_duration_seconds,
    testTitle: row.test_title,
    testType: row.test_type,
    versionNumber: row.version_number,
    submissions: row.submissions,
  }));
}
