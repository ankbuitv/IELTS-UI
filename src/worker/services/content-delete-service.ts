import type { Env } from '../env';
import { ApiError } from '../lib/errors';
import { newId, nowIso } from '../lib/ids';

/**
 * Hard-delete a test or a version.
 *
 * SQLite foreign keys on attempts, assignments and mock-component references
 * are not fully cascading, so a naive `DELETE FROM tests` fails with
 * `FOREIGN KEY constraint failed`. These helpers detach or remove dependents
 * in a safe order, then delete the row the administrator asked for.
 */

async function runProtectedDelete(env:Env,statements:D1PreparedStatement[],target:'test'|'version',id:string):Promise<D1Result[]>{
  const guardId=newId('purge_guard');
  const scope=target==='test'?'SELECT id FROM test_versions WHERE test_id=?':'SELECT id FROM test_versions WHERE id=?';
  // D1 batch is one transaction: no assignment can be created between this
  // recursive dependency check and any of the destructive statements.
  const guard=env.DB.prepare(`INSERT INTO content_delete_guards(id,safe)
    WITH RECURSIVE protected(id) AS (SELECT test_version_id FROM assignments UNION SELECT m.test_version_id FROM mock_components m JOIN protected p ON p.id=m.mock_version_id)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM protected WHERE id IN (${scope})) THEN 0 ELSE 1 END`).bind(guardId,id);
  try{return await env.DB.batch([guard,...statements,env.DB.prepare('DELETE FROM content_delete_guards WHERE id=?').bind(guardId)]);}
  catch(error){if((error as Error).message.includes('no_assigned_version'))throw ApiError.conflict('This version is used by an assignment or an assigned mock and cannot be permanently deleted. Archive it instead.');throw error;}
}

async function attemptIdsFor(env: Env, whereSql: string, bindings: string[]): Promise<string[]> {
  const rows = await env.DB.prepare(`SELECT id FROM attempts WHERE ${whereSql}`)
    .bind(...bindings)
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

function attemptCleanupStatements(env: Env, attemptIds: string[]): D1PreparedStatement[] {
  if (attemptIds.length === 0) return [];
  const placeholders = attemptIds.map(() => '?').join(',');
  return [
    env.DB.prepare(
      `DELETE FROM writing_scores WHERE writing_submission_id IN (
         SELECT id FROM writing_submissions WHERE attempt_id IN (${placeholders})
       )`,
    ).bind(...attemptIds),
    env.DB.prepare(`DELETE FROM writing_submissions WHERE attempt_id IN (${placeholders})`).bind(...attemptIds),
    env.DB.prepare(`DELETE FROM attempt_answers WHERE attempt_id IN (${placeholders})`).bind(...attemptIds),
    env.DB.prepare(`DELETE FROM integrity_events WHERE attempt_id IN (${placeholders})`).bind(...attemptIds),
    env.DB.prepare(`DELETE FROM attempt_skill_sessions WHERE attempt_id IN (${placeholders})`).bind(...attemptIds),
    env.DB.prepare(`DELETE FROM attempts WHERE id IN (${placeholders})`).bind(...attemptIds),
  ];
}

function versionContentCleanup(env: Env, versionId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      `DELETE FROM writing_scores WHERE writing_submission_id IN (
         SELECT id FROM writing_submissions WHERE test_version_id = ?
       )`,
    ).bind(versionId),
    env.DB.prepare('DELETE FROM writing_submissions WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare(
      `DELETE FROM attempt_answers WHERE question_id IN (SELECT id FROM questions WHERE test_version_id = ?)`,
    ).bind(versionId),
    env.DB.prepare('DELETE FROM answer_keys WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM questions WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM question_groups WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM sections WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM passages WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM mock_components WHERE mock_version_id = ? OR test_version_id = ?').bind(versionId, versionId),
    env.DB.prepare('DELETE FROM import_drafts WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('UPDATE assets SET test_version_id = NULL WHERE test_version_id = ?').bind(versionId),
    env.DB.prepare('DELETE FROM assignments WHERE test_version_id = ?').bind(versionId),
  ];
}

export async function purgeTest(
  env: Env,
  testId: string,
): Promise<{ deletedAttempts: number; deletedVersions: number; title: string }> {
  const test = await env.DB.prepare('SELECT id, title FROM tests WHERE id = ?')
    .bind(testId)
    .first<{ id: string; title: string }>();
  if (!test) throw ApiError.notFound('Test not found.');

  const versions = await env.DB.prepare('SELECT id FROM test_versions WHERE test_id = ?')
    .bind(testId)
    .all<{ id: string }>();
  const versionIds = versions.results.map((row) => row.id);

  const attemptIds = await attemptIdsFor(env, 'test_id = ?', [testId]);

  const statements: D1PreparedStatement[] = [
    ...attemptCleanupStatements(env, attemptIds),
    env.DB.prepare('DELETE FROM assignments WHERE test_id = ?').bind(testId),
    env.DB.prepare('UPDATE imports SET target_test_id = NULL WHERE target_test_id = ?').bind(testId),
    env.DB.prepare('UPDATE tests SET current_version_id = NULL, updated_at = ? WHERE id = ?').bind(nowIso(), testId),
  ];

  for (const versionId of versionIds) {
    statements.push(...versionContentCleanup(env, versionId));
  }
  if (versionIds.length > 0) {
    const placeholders = versionIds.map(() => '?').join(',');
    statements.push(env.DB.prepare(`DELETE FROM test_versions WHERE id IN (${placeholders})`).bind(...versionIds));
  }
  statements.push(env.DB.prepare('DELETE FROM tests WHERE id = ?').bind(testId));

  await runProtectedDelete(env, statements,'test',testId);
  return { deletedAttempts: attemptIds.length, deletedVersions: versionIds.length, title: test.title };
}

export async function purgeVersion(
  env: Env,
  versionId: string,
): Promise<{ deletedAttempts: number; testId: string; versionNumber: number; testDeleted: boolean }> {
  const version = await env.DB.prepare('SELECT id, test_id, version_number FROM test_versions WHERE id = ?')
    .bind(versionId)
    .first<{ id: string; test_id: string; version_number: number }>();
  if (!version) throw ApiError.notFound('Version not found.');

  const attemptIds = await attemptIdsFor(env, 'test_version_id = ?', [versionId]);

  const statements: D1PreparedStatement[] = [
    ...attemptCleanupStatements(env, attemptIds),
    env.DB.prepare('UPDATE tests SET current_version_id = NULL, updated_at = ? WHERE current_version_id = ?').bind(
      nowIso(),
      versionId,
    ),
    ...versionContentCleanup(env, versionId),
    env.DB.prepare('DELETE FROM test_versions WHERE id = ?').bind(versionId),
    env.DB.prepare('UPDATE imports SET target_test_id=NULL WHERE target_test_id=? AND NOT EXISTS(SELECT 1 FROM test_versions WHERE test_id=?)').bind(version.test_id,version.test_id),
    env.DB.prepare('DELETE FROM tests WHERE id=? AND NOT EXISTS(SELECT 1 FROM test_versions WHERE test_id=?)').bind(version.test_id,version.test_id),
  ];
  const deletion=await runProtectedDelete(env, statements,'version',versionId);

  if (deletion[statements.length]?.meta.changes) {
    return {
      deletedAttempts: attemptIds.length,
      testId: version.test_id,
      versionNumber: version.version_number,
      testDeleted: true,
    };
  }

  const latest = await env.DB.prepare(
    `SELECT id FROM test_versions WHERE test_id = ? AND status = 'PUBLISHED' ORDER BY version_number DESC LIMIT 1`,
  )
    .bind(version.test_id)
    .first<{ id: string }>();
  if (latest) {
    await env.DB.prepare(`UPDATE tests SET status = 'PUBLISHED', current_version_id = ?, updated_at = ? WHERE id = ?`)
      .bind(latest.id, nowIso(), version.test_id)
      .run();
  } else {
    await env.DB.prepare(`UPDATE tests SET status = 'DRAFT', updated_at = ? WHERE id = ?`)
      .bind(nowIso(), version.test_id)
      .run();
  }

  return {
    deletedAttempts: attemptIds.length,
    testId: version.test_id,
    versionNumber: version.version_number,
    testDeleted: false,
  };
}
