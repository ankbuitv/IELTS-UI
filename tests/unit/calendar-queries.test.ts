import { describe, expect, it } from 'vitest';
import {
  CALENDAR_CLASSES_SQL,
  CALENDAR_DEADLINES_SQL,
  CALENDAR_PERSONAL_SQL,
  CALENDAR_SESSIONS_SQL,
} from '@worker/routes/calendar-queries';
import schemaSql from '@worker/lib/runtime-schema.sql';

/**
 * Regression guard for the calendar 503 that surfaced as
 * `D1_ERROR: no such column: a.due_at` and was mis-labelled "The platform
 * database is not initialised yet".
 *
 * The `GET /api/student/calendar` handler read `assignments.due_at`, but the
 * real column (migration 0001 and the canonical runtime schema) is
 * `deadline_at`. Because D1 throws on an unknown column, that one bad
 * reference failed the whole endpoint on every environment that had applied
 * the schema — a schema-perfect, query-wrong bug.
 *
 * These tests run the four calendar queries, exported verbatim from the route,
 * against the real `runtime-schema.sql` on a SQLite engine. A reference to any
 * column that does not exist throws at prepare time, so this pins the entire
 * "query reads a column that is not there" class for the calendar slice — not
 * just this one column.
 */
describe('calendar queries against the real runtime schema', () => {
  // Node 22+ ships node:sqlite. Older runtimes skip rather than fail, matching
  // the schema-heal suite's approach.
  const specifier = 'node:sqlite';

  async function openSchema() {
    const sqlite = (await import(/* @vite-ignore */ specifier).catch(() => null)) as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(...params: unknown[]): unknown[] };
        close(): void;
      };
    } | null;
    if (!sqlite) return null;
    const db = new sqlite.DatabaseSync(':memory:');
    // The route only reads; the calendar queries are all SELECTs, so leaving
    // foreign keys on is safe and keeps the seed honest. The schema is
    // idempotent (IF NOT EXISTS) and self-contained.
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(schemaSql);
    return db;
  }

  it('prepares every calendar query without a missing-column error', async () => {
    const db = await openSchema();
    if (!db) return;
    // SQLite resolves column references at prepare time: an unknown column
    // throws here even before any row is bound. Running all four SELECTs with
    // plausible bind counts proves every referenced column exists.
    for (const [sql, binds] of [
      [CALENDAR_PERSONAL_SQL, ['u1', '2026-01-01', '2026-12-31']],
      [CALENDAR_SESSIONS_SQL, ['u1', 'u1', '2026-01-01', '2026-12-31']],
      [CALENDAR_CLASSES_SQL, ['u1', 'u1', '2026-01-01', '2026-12-31']],
      [CALENDAR_DEADLINES_SQL, ['u1', '2026-01-01', '2026-12-31']],
    ] as const) {
      expect(() => db.prepare(sql).all(...binds), sql).not.toThrow();
    }
    db.close();
  });

  it('surfaces an assignment deadline as a calendar event', async () => {
    const db = await openSchema();
    if (!db) return;
    const now = '2026-10-01T00:00:00.000Z';
    db.exec(`
      INSERT INTO users (id, email, role, created_at, updated_at)
        VALUES ('student', 's@test.local', 'STUDENT', '${now}', '${now}'),
               ('teacher', 't@test.local', 'TEACHER', '${now}', '${now}');
      INSERT INTO classrooms (id, name, teacher_id, join_code, created_at, updated_at)
        VALUES ('room1', 'Class A', 'teacher', 'JOIN1', '${now}', '${now}');
      INSERT INTO classroom_members (id, classroom_id, user_id, status, joined_at, updated_at)
        VALUES ('m1', 'room1', 'student', 'ACTIVE', '${now}', '${now}');
      INSERT INTO tests (id, slug, title, type, created_by, created_at, updated_at)
        VALUES ('test1', 'mock-1', 'Mock', 'WRITING', 'teacher', '${now}', '${now}');
      INSERT INTO test_versions (id, test_id, version_number, created_at, updated_at)
        VALUES ('ver1', 'test1', 1, '${now}', '${now}');
      INSERT INTO assignments (id, classroom_id, teacher_id, test_id, test_version_id, title,
                               deadline_at, status, created_at, updated_at)
        VALUES ('as1', 'room1', 'teacher', 'test1', 'ver1', 'Essay 1',
                '2026-10-15T23:59:00.000Z', 'ACTIVE', '${now}', '${now}');
    `);

    const rows = db.prepare(CALENDAR_DEADLINES_SQL).all('student', '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z') as {
      id: string;
      title: string;
      deadline_at: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'as1', title: 'Essay 1', deadline_at: '2026-10-15T23:59:00.000Z' });
    db.close();
  });
});
