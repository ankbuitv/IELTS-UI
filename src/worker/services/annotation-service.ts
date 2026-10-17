/**
 * Annotations (highlights and notes) for one attempt.
 *
 * Ownership rules are the attempt's rules: the candidate who owns an in-progress
 * attempt may write, anyone who may read the attempt may read the marks, and a
 * submitted attempt is frozen (the paper is not editable after submission either).
 */
import type { Env } from '../env';
import type { AuthUser } from '../lib/auth-types';
import { newId, nowIso } from '../lib/ids';
import { ApiError } from '../lib/errors';
import { requireOwnedAttempt } from './attempt-service';
import { ANNOTATION_COLORS, type AnnotationColor, type ExamAnnotation, type ExamAnnotationInput } from '../../shared/annotations';

interface AnnotationRow {
  id: string;
  attempt_id: string;
  scope: string;
  section_id: string;
  anchor: string;
  start_offset: number;
  end_offset: number;
  excerpt: string;
  color: string;
  note: string | null;
  updated_at: string;
}

function toAnnotation(row: AnnotationRow): ExamAnnotation {
  return {
    id: row.id,
    scope: (row.scope === 'PASSAGE' ? 'PASSAGE' : 'PASSAGE') as ExamAnnotation['scope'],
    sectionId: row.section_id,
    anchor: row.anchor,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    excerpt: row.excerpt,
    color: (ANNOTATION_COLORS as readonly string[]).includes(row.color) ? (row.color as AnnotationColor) : 'yellow',
    note: row.note,
  };
}

export async function listAnnotations(env: Env, user: AuthUser, attemptId: string): Promise<ExamAnnotation[]> {
  // Readable by anyone who may read the attempt (the candidate, their teacher,
  // an admin), so no status restriction here.
  await requireOwnedAttempt(env, user, attemptId);
  const rows = await env.DB.prepare(
    'SELECT id, attempt_id, scope, section_id, anchor, start_offset, end_offset, excerpt, color, note, updated_at FROM attempt_annotations WHERE attempt_id = ? ORDER BY section_id, anchor, start_offset',
  )
    .bind(attemptId)
    .all<AnnotationRow>();
  return rows.results.map(toAnnotation);
}

async function assertWritable(env: Env, user: AuthUser, attemptId: string) {
  const attempt = await requireOwnedAttempt(env, user, attemptId);
  if (attempt.user_id !== user.id) throw ApiError.forbidden('You can only mark up your own attempt.');
  if (attempt.status !== 'IN_PROGRESS') throw ApiError.forbidden('This attempt has been submitted, so its marks are frozen.');
  return attempt;
}

/**
 * Creates a mark, or replaces the one with the same id.
 *
 * Replacing is the update path (re-colouring or adding a note), and it is
 * idempotent on purpose: a retry after a dropped connection must not pile up
 * duplicate highlights.
 */
export async function saveAnnotation(
  env: Env,
  user: AuthUser,
  attemptId: string,
  input: ExamAnnotationInput,
): Promise<ExamAnnotation> {
  await assertWritable(env, user, attemptId);
  const timestamp = nowIso();

  if (input.id) {
    const updated = await env.DB.prepare(
      `UPDATE attempt_annotations
          SET section_id = ?, anchor = ?, start_offset = ?, end_offset = ?, excerpt = ?, color = ?, note = ?, updated_at = ?
        WHERE id = ? AND attempt_id = ?`,
    )
      .bind(
        input.sectionId,
        input.anchor,
        input.startOffset,
        input.endOffset,
        input.excerpt.slice(0, 800),
        input.color,
        input.note ? input.note.slice(0, 800) : null,
        timestamp,
        input.id,
        attemptId,
      )
      .run();
    if ((updated.meta?.changes ?? 0) > 0) {
      const row = await env.DB.prepare('SELECT * FROM attempt_annotations WHERE id = ?').bind(input.id).first<AnnotationRow>();
      if (row) return toAnnotation(row);
    }
    // An id the candidate kept from a previous session that no longer exists
    // (the attempt was reset, or the row was deleted elsewhere): store it fresh.
  }

  // A new mark arrives with the id the browser drew it under, so a retry of a
  // save whose response was lost updates that row instead of adding a second one.
  const id = input.id ?? newId('ann');
  const clash = await env.DB.prepare('SELECT attempt_id FROM attempt_annotations WHERE id = ?').bind(id).first<{ attempt_id: string }>();
  if (clash && clash.attempt_id !== attemptId) throw ApiError.validation('That mark id is already in use.');
  await env.DB.prepare(
    `INSERT INTO attempt_annotations
       (id, attempt_id, user_id, scope, section_id, anchor, start_offset, end_offset, excerpt, color, note, created_at, updated_at)
     VALUES (?, ?, ?, 'PASSAGE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      attemptId,
      user.id,
      input.sectionId,
      input.anchor,
      input.startOffset,
      input.endOffset,
      input.excerpt.slice(0, 800),
      input.color,
      input.note ? input.note.slice(0, 800) : null,
      timestamp,
      timestamp,
    )
    .run();

  const row = await env.DB.prepare('SELECT * FROM attempt_annotations WHERE id = ?').bind(id).first<AnnotationRow>();
  if (!row) throw new ApiError('INTERNAL', 'The mark could not be read back after saving.');
  return toAnnotation(row);
}

export async function deleteAnnotation(env: Env, user: AuthUser, attemptId: string, annotationId: string): Promise<{ ok: true }> {
  await assertWritable(env, user, attemptId);
  await env.DB.prepare('DELETE FROM attempt_annotations WHERE id = ? AND attempt_id = ?').bind(annotationId, attemptId).run();
  return { ok: true };
}

/** Replaces the whole set for an attempt; used by the offline draft on resume. */
export async function replaceAnnotations(
  env: Env,
  user: AuthUser,
  attemptId: string,
  inputs: ExamAnnotationInput[],
): Promise<ExamAnnotation[]> {
  await assertWritable(env, user, attemptId);
  const timestamp = nowIso();
  await env.DB.prepare('DELETE FROM attempt_annotations WHERE attempt_id = ?').bind(attemptId).run();
  for (const input of inputs.slice(0, 400)) {
    await env.DB.prepare(
      `INSERT INTO attempt_annotations
         (id, attempt_id, user_id, scope, section_id, anchor, start_offset, end_offset, excerpt, color, note, created_at, updated_at)
       VALUES (?, ?, ?, 'PASSAGE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        input.id || newId('ann'),
        attemptId,
        user.id,
        input.sectionId,
        input.anchor,
        Math.max(0, Math.trunc(input.startOffset)),
        Math.max(1, Math.trunc(input.endOffset)),
        input.excerpt.slice(0, 800),
        input.color,
        input.note ? input.note.slice(0, 800) : null,
        timestamp,
        timestamp,
      )
      .run();
  }
  return listAnnotations(env, user, attemptId);
}
