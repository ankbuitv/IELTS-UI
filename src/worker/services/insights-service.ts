import type { Env } from '../env';
import { summariseAnswerTimes, type AnswerMoment } from '../../shared/time-analysis';
import type { EstimateSkill } from '../../shared/bands';
import type { AttemptTimeSummary, SkillHistory, StudentInsights } from '../../shared/insights';

/**
 * #5 + #9: the raw material for the band predictor and time analytics.
 *
 * Bands come from the same sources as `getBandEstimates` (objective skill
 * sessions, writing submissions and speaking sessions) but are returned as a
 * time series so the client can project to an exam date. Time comes from the
 * saved answer timestamps; the method note is sent with the data so the UI can
 * be honest about it.
 */

const MAX_ATTEMPTS = 8;

interface BandRow {
  skill: string;
  band: number;
  at: string;
}

export async function getStudentInsights(env: Env, userId: string): Promise<StudentInsights> {
  const points = new Map<EstimateSkill, Array<{ band: number; at: string }>>([
    ['LISTENING', []],
    ['READING', []],
    ['WRITING', []],
    ['SPEAKING', []],
  ]);

  const objective = await env.DB.prepare(
    `SELECT s.skill, s.estimated_band AS band, COALESCE(a.submitted_at, a.started_at) AS at
       FROM attempt_skill_sessions s
       JOIN attempts a ON a.id = s.attempt_id
      WHERE a.user_id = ? AND a.status IN ('SUBMITTED', 'EXPIRED')
        AND s.skill IN ('READING', 'LISTENING') AND s.estimated_band IS NOT NULL
      ORDER BY at ASC`,
  )
    .bind(userId)
    .all<BandRow>();
  for (const row of objective.results ?? []) {
    if (row.skill !== 'READING' && row.skill !== 'LISTENING') continue;
    points.get(row.skill)?.push({ band: row.band, at: row.at });
  }

  const writing = await env.DB.prepare(
    `SELECT 'WRITING' AS skill, s.estimated_band AS band, COALESCE(a.submitted_at, a.started_at) AS at
       FROM attempt_skill_sessions s JOIN attempts a ON a.id = s.attempt_id
      WHERE a.user_id = ? AND a.status IN ('SUBMITTED', 'EXPIRED')
        AND s.skill = 'WRITING' AND s.estimated_band IS NOT NULL
      ORDER BY at ASC`,
  )
    .bind(userId)
    .all<BandRow>();
  for (const row of writing.results ?? []) points.get('WRITING')?.push({ band: row.band, at: row.at });

  const speaking = await env.DB.prepare(
    `SELECT 'SPEAKING' AS skill, overall_band AS band, COALESCE(marked_at, created_at) AS at
       FROM speaking_sessions WHERE user_id = ? AND overall_band IS NOT NULL
      ORDER BY at ASC`,
  )
    .bind(userId)
    .all<BandRow>()
    .catch(() => ({ results: [] as BandRow[] }));
  for (const row of speaking.results ?? []) points.get('SPEAKING')?.push({ band: row.band, at: row.at });

  const history: SkillHistory[] = (['LISTENING', 'READING', 'WRITING', 'SPEAKING'] as EstimateSkill[]).map((skill) => ({
    skill,
    // The newest 12 results are what the predictor should see; the chart only
    // needs the recent shape of the trend.
    points: (points.get(skill) ?? []).slice(-12),
  }));

  const attempts = await env.DB.prepare(
    `SELECT a.id, a.test_type, a.submitted_at, a.started_at, t.title
       FROM attempts a
       LEFT JOIN test_versions v ON v.id = a.test_version_id
       LEFT JOIN tests t ON t.id = v.test_id
      WHERE a.user_id = ? AND a.status IN ('SUBMITTED', 'EXPIRED')
      ORDER BY COALESCE(a.submitted_at, a.started_at) DESC
      LIMIT ?`,
  )
    .bind(userId, MAX_ATTEMPTS)
    .all<{ id: string; test_type: string; submitted_at: string | null; started_at: string; title: string | null }>();
  const rows = attempts.results ?? [];

  const timeAttempts: AttemptTimeSummary[] = [];
  const allAnswered: number[] = [];
  const allCorrect: number[] = [];
  const allIncorrect: number[] = [];

  for (const attempt of rows) {
    const answers = await env.DB.prepare(
      `SELECT q.number, q.prompt, aa.answered_at, aa.is_correct
         FROM attempt_answers aa
         JOIN questions q ON q.id = aa.question_id
        WHERE aa.attempt_id = ? AND aa.answer_json IS NOT NULL
        ORDER BY q.number`,
    )
      .bind(attempt.id)
      .all<{ number: number; prompt: string; answered_at: string | null; is_correct: number | null }>();

    // Questions with no saved answer still count as unanswered for the report.
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM attempt_answers WHERE attempt_id = ?`,
    )
      .bind(attempt.id)
      .first<{ n: number }>();

    const moments: AnswerMoment[] = (answers.results ?? []).map((row) => ({
      number: row.number,
      prompt: row.prompt || `Question ${row.number}`,
      answeredAt: row.answered_at,
      isCorrect: row.is_correct === null ? null : row.is_correct === 1,
    }));
    const report = summariseAnswerTimes(moments, attempt.started_at);
    const missing = Math.max(0, (total?.n ?? moments.length) - moments.length) + report.unanswered;
    if (report.perQuestion.length === 0) continue;

    for (const question of report.perQuestion) {
      if (question.seconds <= 0) continue;
      allAnswered.push(question.seconds);
      if (question.isCorrect === true) allCorrect.push(question.seconds);
      if (question.isCorrect === false) allIncorrect.push(question.seconds);
    }

    timeAttempts.push({
      attemptId: attempt.id,
      testType: attempt.test_type,
      title: attempt.title ?? 'Practice attempt',
      submittedAt: attempt.submitted_at,
      answered: report.answered,
      unanswered: missing,
      averageSeconds: report.averageSeconds,
      correctAverage: report.correctAverage,
      incorrectAverage: report.incorrectAverage,
      slowest: report.slowest,
    });
  }

  const mean = (values: number[]) =>
    values.length > 0 ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;

  return {
    history,
    time: {
      attempts: timeAttempts,
      overall: {
        attempts: timeAttempts.length,
        answered: timeAttempts.reduce((total, attempt) => total + attempt.answered, 0),
        averageSeconds: mean(allAnswered) ?? 0,
        hasAccuracySignal: allCorrect.length >= 3 && allIncorrect.length >= 3,
        correctAverage: mean(allCorrect),
        incorrectAverage: mean(allIncorrect),
      },
      method:
        'Seconds per question are estimated from the gap between saved answers, ignoring gaps under one second and breaks over five minutes. Treat them as a guide, not a stopwatch.',
    },
  };
}
