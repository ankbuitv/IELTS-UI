import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import type { AuthUser } from '../lib/auth-types';
import { gradeAnswer, type AnswerKey, type CandidateResponse } from '../../shared/answer-key';
import { isQuestionType, type QuestionGroupConfig } from '../../shared/question-types';
import { estimateBand, type ConversionRange, type ScoringProfile } from '../../shared/scoring';
import { loadPlatformSettings } from '../lib/settings';
import type { Skill } from '../../shared/types';
import { resolveActiveProfileId } from './scoring-profile-service';

interface MarkQuestionRow {
  id: string;
  number: number;
  question_type: string;
  key_json: string | null;
  config_json: string | null;
  group_config_json: string | null;
}

interface MarkAnswerRow {
  question_id: string;
  answer_json: string | null;
  is_flagged: number;
}

export interface SessionMarkResult {
  skillSessionId: string;
  skill: Skill;
  rawScore: number;
  totalQuestions: number;
  band: number | null;
  bandAvailable: boolean;
  bandMessage: string;
  profileId: string | null;
  profileVersion: number | null;
}

export interface AttemptMarkResult {
  attemptId: string;
  rawScore: number;
  totalQuestions: number;
  estimatedBand: number | null;
  sessions: SessionMarkResult[];
}

/**
 * Marks every objective question of an attempt against the protected answer
 * keys of the exact test version that was taken, and persists an immutable
 * result. The browser never contributes to the score.
 */
export async function markAttempt(env: Env, attemptId: string): Promise<AttemptMarkResult> {
  const attempt = await env.DB.prepare(
    'SELECT id, user_id, test_version_id, status FROM attempts WHERE id = ?',
  )
    .bind(attemptId)
    .first<{ id: string; user_id: string; test_version_id: string; status: string }>();
  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  const settings = await loadPlatformSettings(env);

  const sessions = await env.DB.prepare(
    `SELECT s.id, s.skill, s.component_index, s.test_version_id, v.scoring_profile_id, v.is_complete_test, v.total_questions
       FROM attempt_skill_sessions s
       JOIN test_versions v ON v.id = s.test_version_id
      WHERE s.attempt_id = ?
      ORDER BY s.component_index`,
  )
    .bind(attemptId)
    .all<{
      id: string;
      skill: Skill;
      component_index: number;
      test_version_id: string;
      scoring_profile_id: string | null;
      is_complete_test: number;
      total_questions: number;
    }>();

  const sessionResults: SessionMarkResult[] = [];
  const statements: D1PreparedStatement[] = [];
  const markedAt = nowIso();

  for (const session of sessions.results) {
    if (session.skill === 'WRITING') {
      // Writing is teacher/admin scored; no automatic marks exist to write.
      sessionResults.push({
        skillSessionId: session.id,
        skill: session.skill,
        rawScore: 0,
        totalQuestions: 0,
        band: null,
        bandAvailable: false,
        bandMessage: 'Writing is assessed by a teacher or administrator.',
        profileId: null,
        profileVersion: null,
      });
      continue;
    }

    const questions = await env.DB.prepare(
      `SELECT q.id, q.number,
              q.config_json,
              g.config_json AS group_config_json,
              g.question_type AS question_type,
              k.answer_json AS key_json
         FROM questions q
         JOIN question_groups g ON g.id = q.question_group_id
         LEFT JOIN answer_keys k ON k.question_id = q.id
        WHERE q.test_version_id = ?
        ORDER BY q.number`,
    )
      .bind(session.test_version_id)
      .all<MarkQuestionRow>();

    const responses = await env.DB.prepare(
      `SELECT question_id, answer_json, is_flagged FROM attempt_answers
        WHERE attempt_id = ? AND skill_session_id = ?`,
    )
      .bind(attemptId, session.id)
      .all<MarkAnswerRow>();

    const responseByQuestion = new Map(responses.results.map((r) => [r.question_id, r]));

    let rawScore = 0;
    let totalQuestions = 0;

    for (const question of questions.results) {
      if (!isQuestionType(question.question_type)) continue;
      if (question.question_type === 'WRITING_TASK_1' || question.question_type === 'WRITING_TASK_2') continue;

      const key = question.key_json ? parseJson<AnswerKey | null>(question.key_json, null) : null;
      if (!key || (key.kind === 'CHOICE' && key.values.length === 0) || (key.kind === 'TEXT' && key.accept.length === 0)) {
        // Missing key: exclude from the total so an authoring gap cannot
        // silently depress a candidate's raw score. Reported to admins instead.
        continue;
      }
      totalQuestions += 1;

      const responseRow = responseByQuestion.get(question.id);
      const response = responseRow?.answer_json
        ? parseJson<CandidateResponse | null>(responseRow.answer_json, null)
        : null;
      const groupConfig = parseJson<QuestionGroupConfig>(question.group_config_json, {});
      const questionConfig = parseJson<QuestionGroupConfig>(question.config_json, {});
      const config: QuestionGroupConfig = { ...groupConfig, ...questionConfig };

      const graded = gradeAnswer(question.question_type, key, response, config);
      rawScore += graded.points;

      statements.push(
        env.DB.prepare(
          `INSERT INTO attempt_answers (id, attempt_id, skill_session_id, question_id, test_version_id, answer_json,
                                        is_flagged, answered_at, updated_at, is_correct, points, marked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (attempt_id, question_id)
           DO UPDATE SET is_correct = excluded.is_correct, points = excluded.points, marked_at = excluded.marked_at`,
        ).bind(
          `mk_${attemptId}_${question.id}`,
          attemptId,
          session.id,
          question.id,
          session.test_version_id,
          responseRow?.answer_json ?? null,
          responseRow?.is_flagged ?? 0,
          responseRow?.answer_json ? markedAt : null,
          markedAt,
          graded.correct ? 1 : 0,
          graded.points,
          markedAt,
        ),
      );
    }

    let profileRow = session.scoring_profile_id
      ? await loadScoringProfile(env, session.scoring_profile_id)
      : null;
    if (!profileRow || profileRow.skill !== session.skill) {
      // Use the built-in Reading/Listening table when the version has none (or
      // the attached profile is for a different skill). Do not write back to
      // test_versions — historical attachments stay as they were authored.
      const fallbackId = await resolveActiveProfileId(env, session.skill);
      profileRow = fallbackId ? await loadScoringProfile(env, fallbackId) : null;
    }

    const bandEstimate = settings.bandEstimationEnabled
      ? estimateBand({
          profile: profileRow,
          skill: session.skill,
          rawScore,
          totalQuestions,
          isCompleteTest: session.is_complete_test === 1,
        })
      : {
          available: false as const,
          reason: 'PLATFORM_DISABLED' as const,
          message:
            'Band estimation is switched off in platform settings. The raw score is still marked on the server.',
        };

    statements.push(
      env.DB.prepare(
        `UPDATE attempt_skill_sessions
            SET raw_score = ?, total_questions = ?, estimated_band = ?, scoring_profile_id = ?, scoring_profile_version = ?,
                updated_at = ?
          WHERE id = ?`,
      ).bind(
        rawScore,
        totalQuestions,
        bandEstimate.available ? bandEstimate.band : null,
        bandEstimate.available ? bandEstimate.profileId : (profileRow?.id ?? null),
        bandEstimate.available ? bandEstimate.profileVersion : (profileRow?.version ?? null),
        markedAt,
        session.id,
      ),
    );

    sessionResults.push({
      skillSessionId: session.id,
      skill: session.skill,
      rawScore,
      totalQuestions,
      band: bandEstimate.available ? bandEstimate.band : null,
      bandAvailable: bandEstimate.available,
      bandMessage: bandEstimate.available ? bandEstimate.note : bandEstimate.message,
      profileId: profileRow?.id ?? null,
      profileVersion: profileRow?.version ?? null,
    });

    if (statements.length > 40) {
      await env.DB.batch(statements.splice(0, statements.length));
    }
  }

  if (statements.length > 0) await env.DB.batch(statements);

  const rawScore = sessionResults.reduce((total, session) => total + session.rawScore, 0);
  const totalQuestions = sessionResults.reduce((total, session) => total + session.totalQuestions, 0);

  await env.DB.prepare(
    `UPDATE attempts
        SET raw_score = ?, total_questions = ?, estimated_band = ?, marked_at = ?, marked_revision = marked_revision + 1,
            updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      rawScore,
      totalQuestions,
      sessionResults.length === 1 && sessionResults[0]!.band !== null ? sessionResults[0]!.band : averageBand(sessionResults),
      markedAt,
      markedAt,
      attemptId,
    )
    .run();

  return {
    attemptId,
    rawScore,
    totalQuestions,
    estimatedBand: averageBand(sessionResults),
    sessions: sessionResults,
  };
}

/** Multi-skill attempts report an average of the available skill bands (rounded to 0.5). */
function averageBand(sessions: SessionMarkResult[]): number | null {
  const bands = sessions.filter((s) => s.band !== null).map((s) => s.band as number);
  if (bands.length === 0) return null;
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  return Math.round(mean * 2) / 2;
}

export async function loadScoringProfile(env: Env, profileId: string): Promise<ScoringProfile | null> {
  const row = await env.DB.prepare('SELECT * FROM scoring_profiles WHERE id = ?').bind(profileId).first<{
    id: string;
    name: string;
    skill: Skill;
    test_type: ScoringProfile['testType'];
    version: number;
    status: 'ACTIVE' | 'INACTIVE';
    min_questions: number;
    source_notes: string;
  }>();
  if (!row) return null;

  const ranges = await env.DB.prepare(
    'SELECT raw_min, raw_max, band FROM score_conversion_ranges WHERE profile_id = ? ORDER BY raw_min',
  )
    .bind(profileId)
    .all<{ raw_min: number; raw_max: number; band: number }>();

  return {
    id: row.id,
    name: row.name,
    skill: row.skill,
    testType: row.test_type,
    version: row.version,
    status: row.status,
    minQuestions: row.min_questions,
    sourceNotes: row.source_notes,
    ranges: ranges.results.map(
      (range): ConversionRange => ({ rawMin: range.raw_min, rawMax: range.raw_max, band: range.band }),
    ),
  };
}

/**
 * Human override of a single objective item. Recalculates the session and
 * attempt totals from stored marks without re-running automatic grading, so a
 * later auto-mark does not have to be the last word.
 */
export async function markQuestionManually(
  env: Env,
  attemptId: string,
  input: { questionId: string; isCorrect: boolean | null; points?: number | null },
): Promise<{ rawScore: number; totalQuestions: number }> {
  const attempt = await env.DB.prepare('SELECT id, status FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<{ id: string; status: string }>();
  if (!attempt) throw ApiError.notFound('Attempt not found.');
  if (attempt.status === 'IN_PROGRESS') {
    throw ApiError.conflict('Submit the attempt before marking it.');
  }

  const question = await env.DB.prepare(
    `SELECT q.id, q.test_version_id, g.question_type, s.id AS session_id
       FROM questions q
       JOIN question_groups g ON g.id = q.question_group_id
       JOIN attempt_skill_sessions s ON s.attempt_id = ? AND s.test_version_id = q.test_version_id
      WHERE q.id = ?`,
  )
    .bind(attemptId, input.questionId)
    .first<{ id: string; test_version_id: string; question_type: string; session_id: string }>();
  if (!question) throw ApiError.notFound('That question does not belong to this attempt.');
  if (question.question_type === 'WRITING_TASK_1' || question.question_type === 'WRITING_TASK_2') {
    throw ApiError.validation('Writing tasks are marked with a band score, not correct/incorrect.');
  }

  const timestamp = nowIso();
  const points =
    input.isCorrect === null ? null : (input.points ?? (input.isCorrect ? 1 : 0));
  const isCorrect = input.isCorrect === null ? null : input.isCorrect ? 1 : 0;

  await env.DB.prepare(
    `INSERT INTO attempt_answers (id, attempt_id, skill_session_id, question_id, test_version_id, answer_json,
                                  is_flagged, answered_at, updated_at, is_correct, points, marked_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?, ?)
     ON CONFLICT (attempt_id, question_id)
     DO UPDATE SET is_correct = excluded.is_correct, points = excluded.points, marked_at = excluded.marked_at,
                   updated_at = excluded.updated_at`,
  )
    .bind(
      `mk_${attemptId}_${input.questionId}`,
      attemptId,
      question.session_id,
      input.questionId,
      question.test_version_id,
      timestamp,
      isCorrect,
      points,
      timestamp,
    )
    .run();

  return recountAttemptTotals(env, attemptId);
}

export async function setWritingScore(
  env: Env,
  input: {
    writingSubmissionId: string;
    band: number | null;
    feedback?: string;
    criteria?: Record<string, number>;
    source: 'TEACHER' | 'ADMIN';
    scoredBy: string;
  },
): Promise<{ attemptId: string }> {
  const submission = await env.DB.prepare('SELECT id, attempt_id FROM writing_submissions WHERE id = ?')
    .bind(input.writingSubmissionId)
    .first<{ id: string; attempt_id: string }>();
  if (!submission) throw ApiError.notFound('Writing submission not found.');

  const timestamp = nowIso();
  await env.DB.prepare(
    `INSERT INTO writing_scores (id, writing_submission_id, band, criteria_json, feedback, scoring_source, scored_by, scored_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (writing_submission_id)
     DO UPDATE SET band = excluded.band, criteria_json = excluded.criteria_json, feedback = excluded.feedback,
                   scoring_source = excluded.scoring_source, scored_by = excluded.scored_by,
                   scored_at = excluded.scored_at, updated_at = excluded.updated_at`,
  )
    .bind(
      newId('ws'),
      input.writingSubmissionId,
      input.band,
      JSON.stringify(input.criteria ?? {}),
      input.feedback ?? '',
      input.source,
      input.scoredBy,
      timestamp,
      timestamp,
      timestamp,
    )
    .run();

  const overall = await averageWritingBand(env, submission.attempt_id);
  await env.DB.prepare(
    `UPDATE attempt_skill_sessions
        SET estimated_band = ?, updated_at = ?
      WHERE attempt_id = ? AND skill = 'WRITING'`,
  )
    .bind(overall, timestamp, submission.attempt_id)
    .run();

  const sessionBands = await env.DB.prepare(
    `SELECT estimated_band FROM attempt_skill_sessions WHERE attempt_id = ? AND estimated_band IS NOT NULL`,
  )
    .bind(submission.attempt_id)
    .all<{ estimated_band: number }>();
  const bands = sessionBands.results.map((row) => row.estimated_band);
  const attemptBand =
    bands.length === 0 ? null : Math.round((bands.reduce((sum, band) => sum + band, 0) / bands.length) * 2) / 2;

  await env.DB.prepare('UPDATE attempts SET estimated_band = ?, marked_at = ?, updated_at = ? WHERE id = ?').bind(
    attemptBand,
    timestamp,
    timestamp,
    submission.attempt_id,
  ).run();

  return { attemptId: submission.attempt_id };
}

/** Task 2 is weighted twice when both tasks have a band, matching IELTS writing. */
async function averageWritingBand(env: Env, attemptId: string): Promise<number | null> {
  const rows = await env.DB.prepare(
    `SELECT w.task_label, s.band
       FROM writing_submissions w
       JOIN writing_scores s ON s.writing_submission_id = w.id
      WHERE w.attempt_id = ? AND s.band IS NOT NULL`,
  )
    .bind(attemptId)
    .all<{ task_label: string; band: number }>();
  if (rows.results.length === 0) return null;
  const task1 = rows.results.find((row) => /task\s*1/i.test(row.task_label));
  const task2 = rows.results.find((row) => /task\s*2/i.test(row.task_label));
  if (task1 && task2) return Math.round(((task1.band + 2 * task2.band) / 3) * 2) / 2;
  const mean = rows.results.reduce((sum, row) => sum + row.band, 0) / rows.results.length;
  return Math.round(mean * 2) / 2;
}

export interface WritingQueueItem {
  submissionId: string;
  attemptId: string;
  studentId: string;
  studentEmail: string;
  studentName: string;
  testTitle: string;
  testType: string;
  taskLabel: string;
  wordCount: number;
  prompt: string;
  responseText: string;
  submittedAt: string | null;
  attemptStatus: string;
  scoreBand: number | null;
  feedback: string;
  scoringSource: string | null;
  criteria: Record<string, number>;
}

/** Writing responses waiting for (or already given) a human band. */
export async function listWritingQueue(
  env: Env,
  user: AuthUser,
  options: { unmarkedOnly?: boolean; limit?: number } = {},
): Promise<{ submissions: WritingQueueItem[]; unmarkedCount: number }> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const teacherFilter =
    user.role === 'ADMIN'
      ? ''
      : `AND (
           EXISTS (
             SELECT 1 FROM classroom_members student
             JOIN classrooms c ON c.id = student.classroom_id
            WHERE student.user_id = a.user_id AND student.status = 'ACTIVE'
              AND (c.teacher_id = ?
                   OR EXISTS (
                     SELECT 1 FROM classroom_members ct
                      WHERE ct.classroom_id = c.id AND ct.user_id = ?
                        AND ct.role = 'CO_TEACHER' AND ct.status = 'ACTIVE'
                   ))
           )
           OR a.assignment_id IN (SELECT id FROM assignments WHERE teacher_id = ?)
         )`;
  const unmarkedFilter = options.unmarkedOnly ? 'AND (ws.id IS NULL OR ws.band IS NULL)' : '';
  const bindings = user.role === 'ADMIN' ? [] : [user.id, user.id, user.id];

  const rows = await env.DB.prepare(
    `SELECT w.id, w.attempt_id, w.task_label, w.word_count, w.response_text, w.submitted_at, w.prompt_snapshot,
            a.user_id, a.status AS attempt_status, a.test_type,
            t.title AS test_title, u.email, p.display_name,
            ws.band, ws.feedback, ws.scoring_source, ws.criteria_json
       FROM writing_submissions w
       JOIN attempts a ON a.id = w.attempt_id
       JOIN tests t ON t.id = a.test_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN writing_scores ws ON ws.writing_submission_id = w.id
      WHERE TRIM(w.response_text) != ''
        AND a.status IN ('SUBMITTED', 'EXPIRED')
        ${teacherFilter}
        ${unmarkedFilter}
      ORDER BY CASE WHEN ws.band IS NULL THEN 0 ELSE 1 END, COALESCE(w.submitted_at, w.updated_at) DESC
      LIMIT ${limit}`,
  )
    .bind(...bindings)
    .all<{
      id: string;
      attempt_id: string;
      task_label: string;
      word_count: number;
      response_text: string;
      submitted_at: string | null;
      prompt_snapshot: string | null;
      user_id: string;
      attempt_status: string;
      test_type: string;
      test_title: string;
      email: string;
      display_name: string | null;
      band: number | null;
      feedback: string | null;
      scoring_source: string | null;
      criteria_json: string | null;
    }>();

  const unmarked = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM writing_submissions w
       JOIN attempts a ON a.id = w.attempt_id
       LEFT JOIN writing_scores ws ON ws.writing_submission_id = w.id
      WHERE TRIM(w.response_text) != ''
        AND a.status IN ('SUBMITTED', 'EXPIRED')
        AND (ws.id IS NULL OR ws.band IS NULL)
        ${teacherFilter}`,
  )
    .bind(...bindings)
    .first<{ n: number }>();

  return {
    unmarkedCount: unmarked?.n ?? 0,
    submissions: rows.results.map((row) => ({
      submissionId: row.id,
      attemptId: row.attempt_id,
      studentId: row.user_id,
      studentEmail: row.email,
      studentName: row.display_name ?? row.email,
      testTitle: row.test_title,
      testType: row.test_type,
      taskLabel: row.task_label,
      wordCount: row.word_count,
      prompt: row.prompt_snapshot ?? '',
      responseText: row.response_text,
      submittedAt: row.submitted_at,
      attemptStatus: row.attempt_status,
      scoreBand: row.band,
      feedback: row.feedback ?? '',
      scoringSource: row.scoring_source,
      criteria: parseJson<Record<string, number>>(row.criteria_json, {}),
    })),
  };
}

async function recountAttemptTotals(
  env: Env,
  attemptId: string,
): Promise<{ rawScore: number; totalQuestions: number }> {
  const timestamp = nowIso();
  const sessions = await env.DB.prepare('SELECT id FROM attempt_skill_sessions WHERE attempt_id = ?')
    .bind(attemptId)
    .all<{ id: string }>();

  for (const session of sessions.results) {
    const totals = await env.DB.prepare(
      `SELECT COALESCE(SUM(points), 0) AS raw, COUNT(*) AS total
         FROM attempt_answers
        WHERE skill_session_id = ? AND is_correct IS NOT NULL`,
    )
      .bind(session.id)
      .first<{ raw: number; total: number }>();
    await env.DB.prepare(
      `UPDATE attempt_skill_sessions SET raw_score = ?, total_questions = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(totals?.raw ?? 0, totals?.total ?? 0, timestamp, session.id)
      .run();
  }

  const attemptTotals = await env.DB.prepare(
    `SELECT COALESCE(SUM(raw_score), 0) AS raw, COALESCE(SUM(total_questions), 0) AS total
       FROM attempt_skill_sessions WHERE attempt_id = ?`,
  )
    .bind(attemptId)
    .first<{ raw: number; total: number }>();

  await env.DB.prepare(
    `UPDATE attempts SET raw_score = ?, total_questions = ?, marked_at = ?, marked_revision = marked_revision + 1, updated_at = ?
      WHERE id = ?`,
  )
    .bind(attemptTotals?.raw ?? 0, attemptTotals?.total ?? 0, timestamp, timestamp, attemptId)
    .run();

  return { rawScore: attemptTotals?.raw ?? 0, totalQuestions: attemptTotals?.total ?? 0 };
}
