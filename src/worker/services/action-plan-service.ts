import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import type { ActionPlan, ActionPlanFocus, ActionPlanTask } from '../../shared/action-plan';
import { planWeekStart } from '../../shared/action-plan';

/**
 * Weekly action plan: three concrete things to do this week, derived from the
 * learner's own marks. It never calls a model — the same inputs always produce
 * the same plan, and a learner with no history gets a sensible starter plan
 * instead of invented feedback.
 */

const KEY_META: Record<string, { label: string; skill: 'WRITING' | 'SPEAKING' }> = {
  TA: { label: 'Task achievement', skill: 'WRITING' },
  TR: { label: 'Task response', skill: 'WRITING' },
  CC: { label: 'Coherence & cohesion', skill: 'WRITING' },
  LR: { label: 'Lexical resource', skill: 'WRITING' },
  GRA: { label: 'Grammatical range & accuracy', skill: 'WRITING' },
  TASK_ACHIEVEMENT: { label: 'Task achievement', skill: 'WRITING' },
  TASK_RESPONSE: { label: 'Task response', skill: 'WRITING' },
  COHERENCE_COHESION: { label: 'Coherence & cohesion', skill: 'WRITING' },
  LEXICAL_RESOURCE: { label: 'Lexical resource', skill: 'WRITING' },
  GRAMMATICAL_RANGE: { label: 'Grammatical range & accuracy', skill: 'WRITING' },
  FC: { label: 'Fluency & coherence', skill: 'SPEAKING' },
  P: { label: 'Pronunciation', skill: 'SPEAKING' },
  FLUENCY_COHERENCE: { label: 'Fluency & coherence', skill: 'SPEAKING' },
  PRONUNCIATION: { label: 'Pronunciation', skill: 'SPEAKING' },
};

export interface ActionPlanInput {
  writingCriteria: Record<string, number>[];
  speakingCriteria: Record<string, number>[];
  wordsDue: number;
  attemptsSubmitted: number;
  writingSubmitted: number;
  speakingSubmitted: number;
  averageBand: number | null;
}

function criterionAverages(input: ActionPlanInput): Map<string, { total: number; count: number; skill: 'WRITING' | 'SPEAKING' }> {
  const averages = new Map<string, { total: number; count: number; skill: 'WRITING' | 'SPEAKING' }>();
  const add = (criteria: Record<string, number>, expected: 'WRITING' | 'SPEAKING') => {
    for (const [key, value] of Object.entries(criteria)) {
      const meta = KEY_META[key.toUpperCase()];
      if (!meta || meta.skill !== expected) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      const entry = averages.get(meta.label) ?? { total: 0, count: 0, skill: meta.skill };
      entry.total += value;
      entry.count += 1;
      averages.set(meta.label, entry);
    }
  };
  input.writingCriteria.forEach((criteria) => add(criteria, 'WRITING'));
  input.speakingCriteria.forEach((criteria) => add(criteria, 'SPEAKING'));
  return averages;
}

/** The lowest-marked criterion, or null when no rubric score exists yet. */
export function weakestCriterion(input: ActionPlanInput): ActionPlanFocus | null {
  let weakest: ActionPlanFocus | null = null;
  let weakestValue = Infinity;
  for (const [label, entry] of criterionAverages(input)) {
    const mean = entry.total / entry.count;
    if (mean < weakestValue) {
      weakestValue = mean;
      weakest = {
        criterion: label,
        label,
        skill: entry.skill,
        band: Math.round(mean * 10) / 10,
      };
    }
  }
  return weakest;
}

function task(id: string, task: Omit<ActionPlanTask, 'id' | 'done'>): ActionPlanTask {
  return { id, done: false, ...task };
}

/**
 * Build the three tasks. Order matters: the weakest criterion first, then the
 * maintenance habit (vocabulary due), then reviewing mistakes or speaking.
 */
export function buildActionPlan(input: ActionPlanInput): { tasks: ActionPlanTask[]; focus: ActionPlanFocus | null; summary: string } {
  const focus = weakestCriterion(input);
  const tasks: ActionPlanTask[] = [];

  if (focus) {
    const writing = focus.skill === 'WRITING';
    tasks.push(
      task('focus', {
        title: writing ? `Viết một Task 2 trong 40 phút — tập trung ${focus.label}` : `Ghi âm Part 2 trong 2 phút — tập trung ${focus.label}`,
        detail: writing
          ? `Điểm trung bình của tiêu chí này là ${focus.band?.toFixed(1) ?? '—'}. Viết xong hãy đọc lại đúng tiêu chí đó trước khi xem điểm AI.`
          : `Điểm trung bình của tiêu chí này là ${focus.band?.toFixed(1) ?? '—'}. Nghe lại bản ghi và đếm số lần ngập ngừng.`,
        href: writing ? '/practice' : '/speaking',
        skill: writing ? 'WRITING' : 'SPEAKING',
        minutes: writing ? 40 : 20,
      }),
    );
  }

  if (input.wordsDue > 0) {
    tasks.push(
      task('vocab', {
        title: `Ôn ${Math.min(input.wordsDue, 20)} từ đến hạn`,
        detail: 'Từ đã đến lịch ôn sẽ quay lại ít dần; bỏ một tuần là chúng dồn lại tuần sau.',
        href: '/learn/review',
        skill: 'VOCABULARY',
        minutes: 15,
      }),
    );
  }

  if (input.attemptsSubmitted > 0) {
    tasks.push(
      task('review', {
        title: 'Xem lại bài gần nhất và ghi lại 3 lỗi',
        detail: 'Mở phần review, đọc giải thích của từng câu sai, rồi ghi lại 3 lỗi lặp lại nhiều nhất.',
        href: '/history',
        skill: 'MIXED',
        minutes: 20,
      }),
    );
  }

  if (tasks.length < 3) {
    tasks.push(
      task('speaking', {
        title: 'Ghi âm 1 câu trả lời Speaking Part 1 (60 giây)',
        detail: 'Chọn một chủ đề quen thuộc, nói một mạch 60 giây, rồi nghe lại để sửa ngữ pháp.',
        href: '/speaking',
        skill: 'SPEAKING',
        minutes: 10,
      }),
    );
  }

  if (tasks.length < 3 && input.writingSubmitted === 0) {
    tasks.push(
      task('diagnostic', {
        title: 'Làm một bài Writing chẩn đoán',
        detail: 'Một bài Task 2 là đủ để AI chấm và chỉ ra tiêu chí yếu nhất của bạn.',
        href: '/practice',
        skill: 'WRITING',
        minutes: 40,
      }),
    );
  }

  if (tasks.length < 3) {
    tasks.push(
      task('learn', {
        title: 'Hoàn thành một lesson trên Learn',
        detail: 'Bài ngắn 10–15 phút, giữ chuỗi ngày học và mở khoá phần luyện tiếp theo.',
        href: '/learn',
        skill: 'MIXED',
        minutes: 15,
      }),
    );
  }

  const summary = focus
    ? `Tuần này ưu tiên ${focus.label} (${focus.skill === 'WRITING' ? 'Writing' : 'Speaking'}, band trung bình ${focus.band?.toFixed(1) ?? '—'}).`
    : input.attemptsSubmitted > 0
      ? 'Chưa có điểm theo tiêu chí. Tuần này hãy làm thêm một bài Writing hoặc Speaking để có dữ liệu cá nhân hoá.'
      : 'Bắt đầu bằng một bài chẩn đoán, sau đó kế hoạch sẽ bám theo điểm yếu thật của bạn.';

  return { tasks: tasks.slice(0, 3), focus, summary };
}

async function loadInput(env: Env, userId: string, now: Date): Promise<ActionPlanInput> {
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const [writing, speaking, vocab, attempts] = await Promise.all([
    env.DB.prepare(
      `SELECT ws.criteria_json
         FROM writing_scores ws
         JOIN writing_submissions w ON w.id = ws.writing_submission_id
         JOIN attempts a ON a.id = w.attempt_id
        WHERE a.user_id = ? AND ws.scored_at >= ?
        ORDER BY ws.scored_at DESC
        LIMIT 8`,
    )
      .bind(userId, since)
      .all<{ criteria_json: string }>(),
    env.DB.prepare(
      `SELECT criteria_json FROM speaking_sessions
        WHERE user_id = ? AND status IN ('MARKED', 'SUBMITTED') AND created_at >= ?
        ORDER BY created_at DESC LIMIT 5`,
    )
      .bind(userId, since)
      .all<{ criteria_json: string }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM vocabulary_entries
        WHERE user_id = ? AND (due_at IS NULL OR due_at <= ?)`,
    )
      .bind(userId, nowIso())
      .first<{ n: number }>(),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,
         SUM(CASE WHEN submitted_at IS NOT NULL AND test_type = 'WRITING' THEN 1 ELSE 0 END) AS writing,
         SUM(CASE WHEN submitted_at IS NOT NULL AND test_type = 'READING' THEN 1 ELSE 0 END) AS reading,
         SUM(CASE WHEN submitted_at IS NOT NULL AND test_type = 'LISTENING' THEN 1 ELSE 0 END) AS listening,
         AVG(CASE WHEN submitted_at IS NOT NULL THEN estimated_band END) AS band
       FROM attempts WHERE user_id = ? AND started_at >= ?`,
    )
      .bind(userId, since)
      .first<{ submitted: number | null; writing: number | null; reading: number | null; listening: number | null; band: number | null }>(),
  ]);

  const speakingCount = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM speaking_sessions WHERE user_id = ? AND status IN ('MARKED', 'SUBMITTED') AND created_at >= ?`,
  )
    .bind(userId, since)
    .first<{ n: number }>();

  const attemptsSubmitted = Math.round(attempts?.submitted ?? 0) + Math.round(speakingCount?.n ?? 0);
  return {
    writingCriteria: writing.results.map((row) => parseJson<Record<string, number>>(row.criteria_json, {})),
    speakingCriteria: speaking.results.map((row) => parseJson<Record<string, number>>(row.criteria_json, {})),
    wordsDue: vocab?.n ?? 0,
    attemptsSubmitted,
    writingSubmitted: Math.round(attempts?.writing ?? 0),
    speakingSubmitted: speakingCount?.n ?? 0,
    averageBand: attempts?.band ?? null,
  };
}

function readPlan(json: string): ActionPlan {
  return parseJson<ActionPlan>(json, {
    weekStart: '',
    tasks: [],
    focus: null,
    summary: '',
    generatedAt: '',
    completed: 0,
    source: 'RULES',
  });
}

/** This week's plan, created on first read. */
export async function getActionPlan(env: Env, user: AuthUser, refresh = false): Promise<ActionPlan> {
  const now = new Date();
  const weekStart = planWeekStart(now);
  const existing = await env.DB.prepare(
    `SELECT plan_json FROM weekly_action_plans WHERE user_id = ? AND week_start = ?`,
  )
    .bind(user.id, weekStart)
    .first<{ plan_json: string }>();
  if (existing && !refresh) return readPlan(existing.plan_json);

  const input = await loadInput(env, user.id, now);
  const built = buildActionPlan(input);
  const plan: ActionPlan = {
    weekStart,
    tasks: built.tasks,
    focus: built.focus,
    summary: built.summary,
    generatedAt: nowIso(),
    completed: 0,
    source: 'RULES',
  };
  await env.DB.prepare(
    `INSERT INTO weekly_action_plans (id, user_id, week_start, plan_json, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'RULES', ?, ?)
     ON CONFLICT (user_id, week_start) DO UPDATE SET
       plan_json = excluded.plan_json,
       updated_at = excluded.updated_at`,
  )
    .bind(newId('wpl'), user.id, weekStart, JSON.stringify(plan), nowIso(), nowIso())
    .run();
  return plan;
}

export async function setActionPlanTaskDone(
  env: Env,
  user: AuthUser,
  taskId: string,
  done: boolean,
): Promise<ActionPlan> {
  const weekStart = planWeekStart(new Date());
  const row = await env.DB.prepare(
    `SELECT plan_json FROM weekly_action_plans WHERE user_id = ? AND week_start = ?`,
  )
    .bind(user.id, weekStart)
    .first<{ plan_json: string }>();
  if (!row) throw ApiError.notFound('This week has no action plan yet.');
  const plan = readPlan(row.plan_json);
  if (!plan.tasks.some((item) => item.id === taskId)) throw ApiError.notFound('That task is not in this week’s plan.');
  plan.tasks = plan.tasks.map((item) => (item.id === taskId ? { ...item, done } : item));
  plan.completed = plan.tasks.filter((item) => item.done).length;
  await env.DB.prepare(
    `UPDATE weekly_action_plans SET plan_json = ?, updated_at = ? WHERE user_id = ? AND week_start = ?`,
  )
    .bind(JSON.stringify(plan), nowIso(), user.id, weekStart)
    .run();
  return plan;
}
