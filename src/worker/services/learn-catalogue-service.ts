import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso, parseJson } from '../lib/ids';
import { LESSONS, UNITS } from '../../shared/learn-content';
import { lessonItemCount, lessonPreview, normaliseLessonPayload } from '../../shared/lesson-payload';
import {
  LEARN_BANDS,
  LEARN_BAND_LABELS,
  isLessonKind,
  type CatalogueBandSummary,
  type CatalogueLessonRef,
  type CatalogueResponse,
  type CatalogueUnit,
  type LearnBand,
  type LessonKind,
  type LessonPayload,
  type LessonPlayPayload,
  type LessonWord,
} from '../../shared/learn';

/**
 * The learn catalogue: lessons stored in D1 and served over the API.
 *
 * Why this exists: the path used to be a constant compiled into the browser
 * bundle, so it was frozen at sixteen lessons and growing it meant shipping a
 * new Worker. Lessons are rows now, which is what lets the path span nine half
 * bands, carry five kinds of lesson, and let an administrator publish new
 * lessons (generated or written) at any band without a deploy.
 *
 * The built-in content in `src/shared/learn-content.ts` is still the starting
 * point: `ensureCatalogue` inserts it the first time the table is read empty, so
 * a fresh database has a complete working path with no manual seeding step and
 * no migration full of hand-written INSERTs. The insert is idempotent
 * (`INSERT OR IGNORE` on the lesson id), so two isolates racing on a cold
 * database cannot produce duplicates.
 *
 * Only published lessons reach a learner, and a lesson with an `owner_id`
 * belongs to one learner, so a personal generated lesson never appears in
 * anybody else's path. Administrators see drafts and every origin.
 */

/** D1 accepts at most 100 statements per batch; stay well under it. */
const SEED_BATCH_SIZE = 50;
/** Cap on the wrong-option pool sent with a lesson, so the payload stays small. */
const POOL_CAP = 80;

export type LessonOrigin = 'BUILT_IN' | 'ADMIN_AI' | 'PERSONAL_AI';
export type LessonStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

interface LessonRow {
  id: string;
  band: number;
  unit_key: string;
  unit_title: string;
  unit_blurb: string;
  position: number;
  title: string;
  blurb: string;
  kind: string;
  payload_json: string;
  origin: string;
  status: string;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const LESSON_COLUMNS =
  'id, band, unit_key, unit_title, unit_blurb, position, title, blurb, kind, payload_json, origin, status, owner_id, created_by, created_at, updated_at';

function originOf(row: LessonRow): LessonOrigin {
  return row.origin === 'ADMIN_AI' || row.origin === 'PERSONAL_AI' ? row.origin : 'BUILT_IN';
}

function statusOf(row: LessonRow): LessonStatus {
  return row.status === 'DRAFT' || row.status === 'ARCHIVED' ? row.status : 'PUBLISHED';
}

function bandOf(row: LessonRow): LearnBand {
  return LEARN_BANDS.find((band) => band === row.band) ?? LEARN_BANDS[0]!;
}

/** A stored body, cleaned. Null means the row cannot be played and must be skipped. */
function payloadOf(row: LessonRow): { kind: LessonKind; payload: LessonPayload } | null {
  if (!isLessonKind(row.kind)) return null;
  const payload = normaliseLessonPayload(row.kind, parseJson<unknown>(row.payload_json, null));
  return payload ? { kind: row.kind, payload } : null;
}

/** Inserts the built-in lessons when the catalogue is empty. Idempotent. */
export async function ensureCatalogue(env: Env): Promise<void> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM learn_lessons')
    .first<{ total: number }>()
    .catch(() => null);
  if (row && row.total > 0) return;

  const now = nowIso();
  const blurbByUnit = new Map(UNITS.map((unit) => [unit.id, unit.blurb]));
  const statements = LESSONS.map((lesson) =>
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO learn_lessons
           (id, band, unit_key, unit_title, unit_blurb, position, title, blurb, kind, payload_json, origin, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VOCAB', ?, 'BUILT_IN', 'PUBLISHED', ?, ?)`,
      )
      .bind(
        lesson.id,
        lesson.band,
        lesson.unitId,
        lesson.unitTitle,
        blurbByUnit.get(lesson.unitId) ?? '',
        lesson.position,
        lesson.title,
        lesson.blurb,
        JSON.stringify({ words: lesson.words }),
        now,
        now,
      ),
  );

  for (let start = 0; start < statements.length; start += SEED_BATCH_SIZE) {
    await env.DB.batch(statements.slice(start, start + SEED_BATCH_SIZE));
  }
}

/** Everything the catalogue needs about published, non-personal lessons. */
async function publishedLessons(env: Env): Promise<LessonRow[]> {
  const rows = await env.DB.prepare(
    `SELECT ${LESSON_COLUMNS} FROM learn_lessons
      WHERE status = 'PUBLISHED' AND owner_id IS NULL
      ORDER BY band, position`,
  ).all<LessonRow>();
  return rows.results ?? [];
}

function toRef(row: LessonRow): CatalogueLessonRef | null {
  const body = payloadOf(row);
  if (!body) return null;
  return {
    id: row.id,
    title: row.title,
    blurb: row.blurb,
    position: row.position,
    unitKey: row.unit_key,
    unitTitle: row.unit_title,
    kind: body.kind,
    itemCount: lessonItemCount(body.payload),
    preview: lessonPreview(body.payload),
    origin: originOf(row),
    status: statusOf(row),
  };
}

/**
 * The band selector plus the lessons of one band.
 *
 * Every band is summarised (so the learner can see how much is where and how
 * much they have finished) but only the requested band carries its lessons, and
 * no band carries its bodies — those come from `getLessonPlay` when a lesson is
 * opened. That is what keeps the response small once the path holds hundreds of
 * lessons of five different kinds.
 */
export async function getCatalogue(
  env: Env,
  userId: string,
  requestedBand: LearnBand | null,
): Promise<CatalogueResponse> {
  await ensureCatalogue(env);

  const done = await env.DB.prepare(
    'SELECT lesson_id FROM learn_lessons_done WHERE user_id = ? AND completions > 0',
  )
    .bind(userId)
    .all<{ lesson_id: string }>();
  const completed = new Set((done.results ?? []).map((item) => item.lesson_id));

  const rows = await publishedLessons(env);
  const lessons = rows
    .map((row) => ({ row, ref: toRef(row) }))
    .filter((entry): entry is { row: LessonRow; ref: CatalogueLessonRef } => entry.ref !== null);

  const bands: CatalogueBandSummary[] = LEARN_BANDS.map((band) => {
    const atBand = lessons.filter((entry) => entry.row.band === band);
    return {
      band,
      label: LEARN_BAND_LABELS[band],
      lessonCount: atBand.length,
      completedCount: atBand.filter((entry) => completed.has(entry.row.id)).length,
    };
  });

  // Default to the first band that actually has lessons, so an empty rung at
  // the bottom of the ladder never opens on a blank page.
  const selectedBand =
    requestedBand ?? bands.find((summary) => summary.lessonCount > 0)?.band ?? LEARN_BANDS[0]!;

  const units: CatalogueUnit[] = [];
  for (const entry of lessons.filter((item) => item.row.band === selectedBand)) {
    let unit = units.find((candidate) => candidate.unitKey === entry.row.unit_key);
    if (!unit) {
      unit = {
        unitKey: entry.row.unit_key,
        title: entry.row.unit_title,
        blurb: entry.row.unit_blurb,
        lessons: [],
      };
      units.push(unit);
    }
    unit.lessons.push(entry.ref);
  }

  return {
    bands,
    selected: { band: selectedBand, label: LEARN_BAND_LABELS[selectedBand], units },
  };
}

/** Wrong options for one lesson: other words at the same band, deduplicated. */
export async function wordPool(env: Env, band: number, excludeLessonId: string): Promise<LessonWord[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, payload_json FROM learn_lessons
        WHERE band = ? AND kind = 'VOCAB' AND status = 'PUBLISHED' AND owner_id IS NULL AND id != ?
        ORDER BY position`,
    )
    .bind(band, excludeLessonId)
    .all<{ id: string; payload_json: string }>();

  const pool: LessonWord[] = [];
  const seen = new Set<string>();
  for (const row of rows.results ?? []) {
    const body = normaliseLessonPayload('VOCAB', parseJson<unknown>(row.payload_json, null));
    if (!body || !('words' in body)) continue;
    for (const word of body.words) {
      const key = word.term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(word);
      if (pool.length >= POOL_CAP) return pool;
    }
  }
  return pool;
}

async function readableLesson(env: Env, userId: string, lessonId: string): Promise<LessonRow | null> {
  const row = await env.DB
    .prepare(
      `SELECT ${LESSON_COLUMNS} FROM learn_lessons
        WHERE id = ? AND status = 'PUBLISHED' AND (owner_id IS NULL OR owner_id = ?)`,
    )
    .bind(lessonId, userId)
    .first<LessonRow>();
  return row ?? null;
}

/** A lesson ready to play, with the pool the exercise engine needs. */
export async function getLessonPlay(
  env: Env,
  userId: string,
  lessonId: string,
): Promise<LessonPlayPayload | null> {
  await ensureCatalogue(env);
  const row = await readableLesson(env, userId, lessonId);
  if (!row) return null;
  const body = payloadOf(row);
  if (!body) return null;
  return {
    id: row.id,
    band: bandOf(row),
    kind: body.kind,
    unitTitle: row.unit_title,
    title: row.title,
    blurb: row.blurb,
    payload: body.payload,
    pool: body.kind === 'VOCAB' ? await wordPool(env, row.band, row.id) : [],
  };
}

/**
 * The record `completeLesson` needs to trust a result: the lesson must exist and
 * be playable by this learner, and its body is the only thing a mistake can
 * refer to.
 */
export async function getLessonForCompletion(
  env: Env,
  userId: string,
  lessonId: string,
): Promise<{ id: string; title: string; band: LearnBand; kind: LessonKind; payload: LessonPayload } | null> {
  await ensureCatalogue(env);
  const row = await readableLesson(env, userId, lessonId);
  if (!row) return null;
  const body = payloadOf(row);
  if (!body) return null;
  return { id: row.id, title: row.title, band: bandOf(row), kind: body.kind, payload: body.payload };
}

// ------------------------------------------------------------------ admin side
/** Every lesson an administrator manages, newest last within each band. */
export async function listLessonsForAdmin(
  env: Env,
  filter: { band?: LearnBand | null; status?: LessonStatus | null; kind?: LessonKind | null },
): Promise<Array<CatalogueLessonRef & { band: LearnBand; updatedAt: string }>> {
  await ensureCatalogue(env);
  const clauses: string[] = ["owner_id IS NULL"];
  const args: Array<string | number> = [];
  if (filter.band !== null && filter.band !== undefined) {
    clauses.push('band = ?');
    args.push(filter.band);
  }
  if (filter.status) {
    clauses.push('status = ?');
    args.push(filter.status);
  }
  if (filter.kind) {
    clauses.push('kind = ?');
    args.push(filter.kind);
  }
  const rows = await env.DB.prepare(
    `SELECT ${LESSON_COLUMNS} FROM learn_lessons WHERE ${clauses.join(' AND ')} ORDER BY band, position, id LIMIT 400`,
  )
    .bind(...args)
    .all<LessonRow>();

  return (rows.results ?? [])
    .map((row) => {
      const ref = toRef(row);
      return ref ? { ...ref, band: bandOf(row), updatedAt: row.updated_at } : null;
    })
    .filter((entry): entry is CatalogueLessonRef & { band: LearnBand; updatedAt: string } => entry !== null);
}

export interface LessonDraft {
  band: LearnBand;
  kind: LessonKind;
  unitKey: string;
  unitTitle: string;
  unitBlurb?: string;
  title: string;
  blurb?: string;
  payload: LessonPayload;
  status?: LessonStatus;
  origin?: LessonOrigin;
  ownerId?: string | null;
  createdBy?: string | null;
}

/** The next free position in a band, so a new lesson lands at the end of the path. */
export async function nextPosition(env: Env, band: number): Promise<number> {
  const row = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) AS top FROM learn_lessons WHERE band = ?')
    .bind(band)
    .first<{ top: number }>();
  return (row?.top ?? -1) + 1;
}

/** Inserts one lesson. The body is normalised again here, so nothing unplayable is stored. */
export async function insertLesson(env: Env, draft: LessonDraft): Promise<string> {
  const payload = normaliseLessonPayload(draft.kind, draft.payload);
  if (!payload) throw ApiError.validation('That lesson has no usable content.');
  const id = newId('lsn');
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO learn_lessons
       (id, band, unit_key, unit_title, unit_blurb, position, title, blurb, kind, payload_json, origin, status, owner_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      draft.band,
      draft.unitKey,
      draft.unitTitle,
      draft.unitBlurb ?? '',
      await nextPosition(env, draft.band),
      draft.title.trim().slice(0, 120),
      (draft.blurb ?? '').trim().slice(0, 240),
      draft.kind,
      JSON.stringify(payload),
      draft.origin ?? 'ADMIN_AI',
      draft.status ?? 'PUBLISHED',
      draft.ownerId ?? null,
      draft.createdBy ?? null,
      now,
      now,
    )
    .run();
  return id;
}

/** Publishes, drafts or archives a lesson. Learners only ever see published ones. */
export async function setLessonStatus(env: Env, lessonId: string, status: LessonStatus): Promise<void> {
  const result = await env.DB.prepare('UPDATE learn_lessons SET status = ?, updated_at = ? WHERE id = ? AND owner_id IS NULL')
    .bind(status, nowIso(), lessonId)
    .run();
  if (!result.meta.changes) throw ApiError.notFound('That lesson does not exist.');
}

/**
 * Takes a lesson out of the path.
 *
 * Always an archive, never a DELETE: the built-in rows are the seed a fresh
 * database rebuilds itself from, and a generated row is the only record that it
 * was ever published. `ARCHIVED` rows are invisible to learners and stay
 * visible to an administrator, who can publish one again.
 */
export async function deleteLesson(env: Env, lessonId: string): Promise<void> {
  await setLessonStatus(env, lessonId, 'ARCHIVED');
}
