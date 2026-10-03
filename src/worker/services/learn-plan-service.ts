import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { bandForEstimate, type LearnBand, type PlanItemStatus, type PlanItemView, type PlanRequest, type PlanView } from '../../shared/learn';
import { buildPlanItems, planHorizonDays, type PlanBandSupply, type PlanSkill } from '../../shared/learn-plan';
import { ensureCatalogue } from './learn-catalogue-service';
import { getLearnBand } from './learn-service';

/**
 * Study plans.
 *
 * The catalogue says what exists; a plan says what to do on Tuesday. It is built
 * from two sources the platform already has — the band a learner is placed on
 * (estimated from their recent tests, or chosen by them) and the band they
 * scored in each skill — plus the two things only they know: their target and
 * their exam date.
 *
 * The scheduling itself is the pure `buildPlanItems` in `src/shared/learn-plan.ts`,
 * which is where the rules are tested. This service only gathers the inputs,
 * stores the output, and reads it back. Storing matters: a plan that is
 * recomputed on every page view would shuffle when the catalogue changes
 * underneath it, and the learner's ticks would drift onto different lessons.
 *
 * Rebuilding archives the previous plan rather than deleting it, so what was
 * suggested and what was actually done survives a change of target.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface PlanRow {
  id: string;
  user_id: string;
  target_band: number;
  exam_date: string | null;
  minutes_per_day: number;
  status: string;
  created_at: string;
}

interface ItemRow {
  id: string;
  day: string;
  slot: number;
  kind: string;
  lesson_id: string | null;
  label: string;
  band: number | null;
  skill: string | null;
  status: string;
  lesson_title: string | null;
}

/** The most recent estimated band in each skill, so the plan can name the weakest one. */
async function skillBands(env: Env, userId: string): Promise<Partial<Record<PlanSkill, number>>> {
  const rows = await env.DB.prepare(
    `SELECT s.skill AS skill, s.estimated_band AS band
       FROM attempt_skill_sessions s JOIN attempts a ON a.id = s.attempt_id
      WHERE a.user_id = ? AND s.estimated_band IS NOT NULL
      ORDER BY s.updated_at DESC`,
  )
    .bind(userId)
    .all<{ skill: string; band: number }>();

  const out: Partial<Record<PlanSkill, number>> = {};
  for (const row of rows.results ?? []) {
    if (row.skill !== 'READING' && row.skill !== 'LISTENING' && row.skill !== 'WRITING') continue;
    // The list is newest first, so the first row seen for a skill is its latest.
    if (out[row.skill] === undefined) out[row.skill] = row.band;
  }
  return out;
}

/** The published catalogue grouped by band, in path order, without personal lessons. */
async function supplyByBand(env: Env): Promise<PlanBandSupply[]> {
  const rows = await env.DB.prepare(
    `SELECT band, id FROM learn_lessons
      WHERE status = 'PUBLISHED' AND owner_id IS NULL
      ORDER BY band, position`,
  ).all<{ band: number; id: string }>();

  const byBand = new Map<LearnBand, string[]>();
  for (const row of rows.results ?? []) {
    const band = bandForEstimate(row.band);
    const list = byBand.get(band) ?? [];
    list.push(row.id);
    byBand.set(band, list);
  }
  return [...byBand.entries()].map(([band, lessonIds]) => ({ band, lessonIds }));
}

function toItem(row: ItemRow): PlanItemView {
  return {
    id: row.id,
    day: row.day,
    slot: row.slot,
    kind: row.kind === 'REVIEW' || row.kind === 'MOCK_TEST' ? row.kind : 'LESSON',
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    label: row.label,
    band: row.band === null ? null : bandForEstimate(row.band),
    skill:
      row.skill === 'READING' || row.skill === 'LISTENING' || row.skill === 'WRITING' || row.skill === 'OVERALL'
        ? row.skill
        : null,
    status: row.status === 'DONE' || row.status === 'SKIPPED' ? row.status : 'PENDING',
  };
}

async function activePlan(env: Env, userId: string): Promise<PlanRow | null> {
  return (
    (await env.DB.prepare("SELECT id, user_id, target_band, exam_date, minutes_per_day, status, created_at FROM learn_plans WHERE user_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1")
      .bind(userId)
      .first<PlanRow>()) ?? null
  );
}

/** The learner's active plan, or null when they have never built one. */
export async function getPlan(env: Env, userId: string, day: string): Promise<PlanView | null> {
  const plan = await activePlan(env, userId);
  if (!plan) return null;

  const rows = await env.DB.prepare(
    `SELECT i.id, i.day, i.slot, i.kind, i.lesson_id, i.label, i.band, i.skill, i.status, l.title AS lesson_title
       FROM learn_plan_items i LEFT JOIN learn_lessons l ON l.id = i.lesson_id
      WHERE i.plan_id = ?
      ORDER BY i.day, i.slot`,
  )
    .bind(plan.id)
    .all<ItemRow>();

  const items = (rows.results ?? []).map(toItem);
  const days: Array<{ day: string; items: PlanItemView[] }> = [];
  for (const item of items) {
    let bucket = days[days.length - 1];
    if (!bucket || bucket.day !== item.day) {
      bucket = { day: item.day, items: [] };
      days.push(bucket);
    }
    bucket.items.push(item);
  }

  const lessons = items.filter((item) => item.kind === 'LESSON').length;
  return {
    id: plan.id,
    targetBand: bandForEstimate(plan.target_band),
    examDay: plan.exam_date,
    minutesPerDay: plan.minutes_per_day,
    currentBand: await getLearnBand(env, userId),
    startDay: days[0]?.day ?? day,
    daysCovered: planHorizonDays(days[0]?.day ?? day, plan.exam_date),
    createdAt: plan.created_at,
    skillBands: await skillBands(env, userId),
    stats: {
      total: items.length,
      done: items.filter((item) => item.status === 'DONE').length,
      lessons,
      mocks: items.filter((item) => item.kind === 'MOCK_TEST').length,
    },
    days,
    today: items.filter((item) => item.day === day),
  };
}

/**
 * Builds a plan and makes it the active one.
 *
 * The exam date is optional; a target without a date still gets the default
 * horizon, because "I want a 7" is a usable answer even when the test is not
 * booked.
 */
export async function rebuildPlan(
  env: Env,
  userId: string,
  input: PlanRequest,
  day: string,
): Promise<PlanView> {
  if (!DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw ApiError.validation('That calendar day is not valid.');
  }
  const examDay = input.examDay;
  if (examDay !== null && (!DAY_PATTERN.test(examDay) || Number.isNaN(Date.parse(`${examDay}T00:00:00Z`)))) {
    throw ApiError.validation('That exam date is not valid.');
  }
  const minutesPerDay = Math.min(180, Math.max(5, Math.floor(input.minutesPerDay || 30)));

  await ensureCatalogue(env);
  const currentBand = await getLearnBand(env, userId);
  const supply = await supplyByBand(env);
  const bands = await skillBands(env, userId);
  const known = Object.values(bands).filter((band): band is number => typeof band === 'number');
  const weakest =
    known.length === 0
      ? null
      : (Object.entries(bands).find(([, band]) => band === Math.min(...known))?.[0] as PlanSkill | undefined) ?? null;

  const drafts = buildPlanItems({
    startDay: day,
    examDay,
    currentBand,
    targetBand: input.targetBand,
    minutesPerDay,
    supply,
    weakestSkill: weakest,
  });
  if (drafts.length === 0) {
    throw new ApiError('CONFLICT', 'There are no lessons in the catalogue to build a plan from yet.');
  }

  const planId = newId('pln');
  const now = nowIso();
  const statements = [
    // One active plan per learner: the old one is kept, just out of the way.
    env.DB.prepare("UPDATE learn_plans SET status = 'ARCHIVED', updated_at = ? WHERE user_id = ? AND status = 'ACTIVE'").bind(now, userId),
    env.DB.prepare(
      `INSERT INTO learn_plans (id, user_id, target_band, exam_date, minutes_per_day, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    ).bind(planId, userId, input.targetBand, examDay, minutesPerDay, now, now),
  ];
  for (const draft of drafts) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO learn_plan_items (id, plan_id, day, slot, kind, lesson_id, label, band, skill, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      ).bind(newId('pli'), planId, draft.day, draft.slot, draft.kind, draft.lessonId, draft.label, draft.band, draft.skill, now),
    );
  }
  for (let start = 0; start < statements.length; start += 50) {
    await env.DB.batch(statements.slice(start, start + 50));
  }

  const view = await getPlan(env, userId, day);
  if (!view) throw new ApiError('INTERNAL', 'The plan could not be read back after it was built.');
  return view;
}

/** Ticks a step off, or unticks it. Only the plan's owner can. */
export async function setPlanItemStatus(
  env: Env,
  userId: string,
  itemId: string,
  status: PlanItemStatus,
): Promise<PlanItemView> {
  const row = await env.DB.prepare(
    `SELECT i.id, i.day, i.slot, i.kind, i.lesson_id, i.label, i.band, i.skill, i.status, l.title AS lesson_title
       FROM learn_plan_items i
       JOIN learn_plans p ON p.id = i.plan_id
       LEFT JOIN learn_lessons l ON l.id = i.lesson_id
      WHERE i.id = ? AND p.user_id = ? AND p.status = 'ACTIVE'`,
  )
    .bind(itemId, userId)
    .first<ItemRow>();
  if (!row) throw ApiError.notFound('That step is not on your current plan.');

  await env.DB.prepare('UPDATE learn_plan_items SET status = ?, completed_at = ? WHERE id = ?')
    .bind(status, status === 'DONE' ? nowIso() : null, itemId)
    .run();
  return { ...toItem(row), status };
}

/** Recorded so an administrator can see who generated teaching material and when. */
export async function auditPlan(env: Env, userId: string, planId: string, input: PlanRequest): Promise<void> {
  await recordAudit(env, {
    actorUserId: userId,
    action: 'LEARN_PLAN_REBUILD',
    entityType: 'learn_plan',
    entityId: planId,
    metadata: { targetBand: input.targetBand, examDay: input.examDay, minutesPerDay: input.minutesPerDay },
  });
}
