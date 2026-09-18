import type { Env } from '../env';
import { nowIso } from '../lib/ids';
import {
  DEFAULT_SCORING_PROFILE_SEEDS,
  defaultProfileIdForSkill,
} from '../../shared/default-scoring-profiles';
import type { Skill } from '../../shared/types';

const BUILTIN_IDS = DEFAULT_SCORING_PROFILE_SEEDS.map((seed) => seed.id);

/**
 * Inserts the built-in Reading and Listening conversion tables when they are
 * missing. Idempotent: existing rows (including operator-created profiles) are
 * never overwritten.
 */
export async function ensureDefaultScoringProfiles(env: Env): Promise<void> {
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM scoring_profiles WHERE id IN (${BUILTIN_IDS.map(() => '?').join(',')})`,
    )
      .bind(...BUILTIN_IDS)
      .all<{ id: string }>();
    const have = new Set(existing.results.map((row) => row.id));
    const timestamp = nowIso();
    const statements: D1PreparedStatement[] = [];

    for (const seed of DEFAULT_SCORING_PROFILE_SEEDS) {
      if (!have.has(seed.id)) {
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO scoring_profiles
               (id, name, skill, test_type, version, status, min_questions, source_notes, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?, ?, NULL, ?, ?)`,
          ).bind(
            seed.id,
            seed.name,
            seed.skill,
            seed.testType,
            seed.minQuestions,
            seed.sourceNotes,
            timestamp,
            timestamp,
          ),
        );
      }
      const rangeCount = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM score_conversion_ranges WHERE profile_id = ?',
      )
        .bind(seed.id)
        .first<{ n: number }>();
      if ((rangeCount?.n ?? 0) > 0) continue;
      seed.ranges.forEach((range, index) => {
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO score_conversion_ranges (id, profile_id, raw_min, raw_max, band, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(`${seed.id.replace('scp_', 'scr_')}_${String(index).padStart(2, '0')}`, seed.id, range.rawMin, range.rawMax, range.band, index),
        );
      });
    }

    if (statements.length > 0) await env.DB.batch(statements);
  } catch (error) {
    // Schema bootstrap may not have created the tables yet; the next request retries.
    console.warn('default_scoring_profiles', (error as Error)?.message ?? error);
  }
}

/** Active conversion table for a skill, preferring the built-in defaults. */
export async function resolveActiveProfileId(env: Env, skill: Skill): Promise<string | null> {
  if (skill !== 'READING' && skill !== 'LISTENING') return null;
  await ensureDefaultScoringProfiles(env);
  const preferred = defaultProfileIdForSkill(skill);
  if (preferred) {
    const builtin = await env.DB.prepare(
      `SELECT id FROM scoring_profiles WHERE id = ? AND skill = ? AND status = 'ACTIVE'`,
    )
      .bind(preferred, skill)
      .first<{ id: string }>();
    if (builtin) return builtin.id;
  }
  const row = await env.DB.prepare(
    `SELECT id FROM scoring_profiles WHERE skill = ? AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1`,
  )
    .bind(skill)
    .first<{ id: string }>();
  return row?.id ?? null;
}
