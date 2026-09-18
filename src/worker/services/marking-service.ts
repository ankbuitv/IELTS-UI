import type { Env } from '../env';
import { nowIso, parseJson } from '../lib/ids';
import { gradeAnswer, type AnswerKey, type CandidateResponse } from '../../shared/answer-key';
import { isQuestionType, type QuestionGroupConfig } from '../../shared/question-types';
import { estimateBand, type ConversionRange, type ScoringProfile } from '../../shared/scoring';
import { loadPlatformSettings } from '../lib/settings';
import type { Skill } from '../../shared/types';

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

    const profileRow = session.scoring_profile_id
      ? await loadScoringProfile(env, session.scoring_profile_id)
      : null;

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
