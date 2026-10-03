import type { Env } from '../env';
import { nowIso } from '../lib/ids';
import { loadPlatformSettings } from '../lib/settings';
import { estimateBand } from '../../shared/scoring';
import {
  MIN_QUESTIONS_FOR_PROJECTION,
  summariseEstimates,
  meanBand,
  type BandBasis,
  type BandEstimates,
  type EstimateInput,
} from '../../shared/bands';
import type { Skill } from '../../shared/types';
import { loadScoringProfile } from './marking-service';
import { resolveActiveProfileId } from './scoring-profile-service';

/**
 * "Estimated band" for every skill, not only for complete tests.
 *
 *  - Reading / Listening: converted from the score. A short set is scaled to a
 *    full paper and labelled PROJECTED (see `estimateBand`).
 *  - Writing / Speaking: the AI judges' combined band (AI), replaced by a
 *    teacher's band when one exists (TEACHER).
 *  - Overall: the mean of the skills that have a band, with IELTS rounding. It
 *    is PROVISIONAL until all four skills have contributed.
 *
 * Everything is an estimate for study planning, never an official result.
 */

/** A paper of at least this many questions in a complete test counts as a full-length result. */
const FULL_PAPER_QUESTIONS = 40;

export async function getBandEstimates(env: Env, userId: string): Promise<BandEstimates> {
  await backfillProjectedBands(env, userId).catch((error: unknown) => {
    console.warn('band_backfill_failed', error instanceof Error ? error.message : error);
  });

  const inputs: EstimateInput[] = [];

  const objective = await env.DB.prepare(
    `SELECT s.skill, s.estimated_band AS band, s.total_questions AS total, v.is_complete_test AS complete,
            COALESCE(a.submitted_at, a.started_at) AS at
       FROM attempt_skill_sessions s
       JOIN attempts a ON a.id = s.attempt_id
       JOIN test_versions v ON v.id = a.test_version_id
      WHERE a.user_id = ? AND a.status IN ('SUBMITTED', 'EXPIRED')
        AND s.skill IN ('READING', 'LISTENING') AND s.estimated_band IS NOT NULL
      ORDER BY at DESC LIMIT 40`,
  )
    .bind(userId)
    .all<{ skill: Skill; band: number; total: number | null; complete: number | null; at: string }>();
  for (const row of objective.results ?? []) {
    const basis: BandBasis = row.complete === 1 && (row.total ?? 0) >= FULL_PAPER_QUESTIONS ? 'FULL' : 'PROJECTED';
    inputs.push({ skill: row.skill, band: row.band, basis, at: row.at });
  }

  const writing = await env.DB.prepare(
    `SELECT s.estimated_band AS band, COALESCE(a.submitted_at, a.started_at) AS at,
            (SELECT COUNT(*) FROM writing_scores ws JOIN writing_submissions w ON w.id = ws.writing_submission_id
              WHERE w.attempt_id = a.id AND ws.scoring_source IN ('TEACHER', 'ADMIN')) AS human
       FROM attempt_skill_sessions s JOIN attempts a ON a.id = s.attempt_id
      WHERE a.user_id = ? AND a.status IN ('SUBMITTED', 'EXPIRED')
        AND s.skill = 'WRITING' AND s.estimated_band IS NOT NULL
      ORDER BY at DESC LIMIT 20`,
  )
    .bind(userId)
    .all<{ band: number; at: string; human: number }>();
  for (const row of writing.results ?? []) {
    inputs.push({ skill: 'WRITING', band: row.band, basis: row.human > 0 ? 'TEACHER' : 'AI', at: row.at });
  }

  const speaking = await env.DB.prepare(
    `SELECT overall_band AS band, score_source, COALESCE(marked_at, created_at) AS at
       FROM speaking_sessions WHERE user_id = ? AND overall_band IS NOT NULL
      ORDER BY at DESC LIMIT 20`,
  )
    .bind(userId)
    .all<{ band: number; score_source: string | null; at: string }>()
    .catch(() => ({ results: [] as Array<{ band: number; score_source: string | null; at: string }> }));
  for (const row of speaking.results ?? []) {
    inputs.push({ skill: 'SPEAKING', band: row.band, basis: row.score_source === 'TEACHER' ? 'TEACHER' : 'AI', at: row.at });
  }

  return summariseEstimates(inputs);
}

/**
 * Sets that were marked before short-set projection existed have a raw score
 * and no band. The first time the learner opens their dashboard afterwards the
 * band is worked out from the stored score (idempotent, bounded, best effort).
 */
export async function backfillProjectedBands(env: Env, userId: string): Promise<number> {
  const settings = await loadPlatformSettings(env);
  if (!settings.bandEstimationEnabled) return 0;

  const rows = await env.DB.prepare(
    `SELECT s.id, s.attempt_id, s.skill, s.raw_score, s.total_questions, v.is_complete_test AS complete
       FROM attempt_skill_sessions s
       JOIN attempts a ON a.id = s.attempt_id
       JOIN test_versions v ON v.id = a.test_version_id
      WHERE a.user_id = ? AND a.status IN ('SUBMITTED', 'EXPIRED')
        AND s.skill IN ('READING', 'LISTENING') AND s.estimated_band IS NULL
        AND s.raw_score IS NOT NULL AND s.total_questions >= ?
      ORDER BY a.started_at DESC LIMIT 40`,
  )
    .bind(userId, MIN_QUESTIONS_FOR_PROJECTION)
    .all<{ id: string; attempt_id: string; skill: Skill; raw_score: number; total_questions: number; complete: number }>();
  if (!rows.results?.length) return 0;

  const profiles = new Map<Skill, Awaited<ReturnType<typeof loadScoringProfile>>>();
  const touchedAttempts = new Set<string>();
  const stamp = nowIso();
  let updated = 0;

  for (const row of rows.results) {
    if (!profiles.has(row.skill)) {
      const profileId = await resolveActiveProfileId(env, row.skill);
      profiles.set(row.skill, profileId ? await loadScoringProfile(env, profileId) : null);
    }
    const estimate = estimateBand({
      profile: profiles.get(row.skill) ?? null,
      skill: row.skill,
      rawScore: row.raw_score,
      totalQuestions: row.total_questions,
      isCompleteTest: row.complete === 1,
    });
    if (!estimate.available) continue;
    await env.DB.prepare(
      `UPDATE attempt_skill_sessions
          SET estimated_band = ?, scoring_profile_id = ?, scoring_profile_version = ?, updated_at = ?
        WHERE id = ? AND estimated_band IS NULL`,
    )
      .bind(estimate.band, estimate.profileId, estimate.profileVersion, stamp, row.id)
      .run();
    touchedAttempts.add(row.attempt_id);
    updated += 1;
  }

  // The attempt's own band is the mean of its sessions' bands.
  for (const attemptId of touchedAttempts) {
    const bands = await env.DB.prepare(
      'SELECT estimated_band AS band FROM attempt_skill_sessions WHERE attempt_id = ? AND estimated_band IS NOT NULL',
    )
      .bind(attemptId)
      .all<{ band: number }>();
    const overall = meanBand((bands.results ?? []).map((band) => band.band));
    await env.DB.prepare('UPDATE attempts SET estimated_band = ?, updated_at = ? WHERE id = ? AND estimated_band IS NULL')
      .bind(overall, stamp, attemptId)
      .run();
  }
  return updated;
}
