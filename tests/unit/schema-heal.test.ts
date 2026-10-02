import { describe, expect, it } from 'vitest';
import {
  CHECK_REBUILDS,
  isAddableColumnDefinition,
  isCheckConstraintError,
  parseCreateTableColumns,
  rebuildStatements,
  runtimeExpectedColumns,
  runtimeIndexStatements,
  runtimeTableStatements,
  schemaTableNames,
  splitSqlStatements,
  staleConstraintTables,
} from '@worker/lib/ensure-schema';
import schemaSql from '@worker/lib/runtime-schema.sql';

/**
 * The 503 "The platform database is not initialised yet" on production was a
 * schema-drift failure: the database had been created by an older Worker, so
 * `sections` lacked the migration-0005 columns (`label`, `image_asset_id`, …)
 * and the bootstrap batch aborted on
 * `CREATE INDEX idx_sections_image ON sections (image_asset_id)` — a D1 batch
 * is a transaction, so even the missing tables never got created.
 * These tests pin the column-level healing that fixes that class of failure.
 */
describe('parseCreateTableColumns', () => {
  it('parses every column of every runtime table', () => {
    for (const [table, createSql] of runtimeTableStatements()) {
      const columns = parseCreateTableColumns(createSql);
      expect(columns.length, table).toBeGreaterThan(0);
      for (const column of columns) {
        expect(column.name, `${table}.${column.name}`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
        // A column definition must never swallow the next column: the parser
        // must have split at every top-level comma.
        expect(column.definition, `${table}.${column.name}`).not.toMatch(/,\s*[A-Za-z_]+ (TEXT|INTEGER|REAL|BLOB)\b/);
      }
    }
  });

  it('never mistakes a table constraint for a column', () => {
    const columns = parseCreateTableColumns(`CREATE TABLE IF NOT EXISTS attempt_sections (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      PRIMARY KEY (id),
      UNIQUE (attempt_id, section_id),
      CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS')),
      FOREIGN KEY (attempt_id) REFERENCES attempts (id) ON DELETE CASCADE,
      CONSTRAINT sensible_name CHECK (attempt_id <> '')
    )`);
    expect(columns.map((column) => column.name)).toEqual(['id', 'attempt_id', 'status']);
  });

  it('keeps commas inside quotes, comments and CHECK lists in one column', () => {
    const columns = parseCreateTableColumns(`CREATE TABLE IF NOT EXISTS t (
      role TEXT CHECK (role IN ('A', 'B; C')), -- inline, comma comment
      "order" INTEGER DEFAULT 0,
      note TEXT DEFAULT 'x, y', /* block, comma */
      [group name] TEXT
    )`);
    expect(columns.map((column) => column.name)).toEqual(['role', 'order', 'note', 'group name']);
    expect(columns[0]!.definition).toContain("'B; C'");
    // Comments are stripped, so they can never leak into a generated ALTER.
    expect(columns.some((column) => column.definition.includes('--'))).toBe(false);
  });

  it('parses the generated sections table including its appended migration columns', () => {
    const sections = parseCreateTableColumns(
      runtimeTableStatements().find(([table]) => table === 'sections')![1],
    );
    const names = sections.map((column) => column.name);
    // Columns added by migration 0005 on top of the original CREATE TABLE:
    for (const expected of ['type', 'label', 'description', 'transcript_json', 'image_asset_id']) {
      expect(names, `sections.${expected}`).toContain(expected);
    }
    // And the original columns are still individually parsed.
    expect(names).toContain('order_index');
    expect(names).toContain('audio_asset_id');
  });
});

describe('isAddableColumnDefinition', () => {
  it('accepts the definitions real drift produces', () => {
    expect(isAddableColumnDefinition('TEXT')).toBe(true);
    expect(isAddableColumnDefinition(`TEXT NOT NULL DEFAULT ''`)).toBe(true);
    expect(isAddableColumnDefinition('TEXT REFERENCES assets (id) ON DELETE SET NULL')).toBe(true);
    expect(isAddableColumnDefinition(`TEXT CHECK (type IS NULL OR type IN ('READING_PASSAGE', 'LISTENING_PART'))`)).toBe(true);
  });

  it('rejects what SQLite forbids appending to an existing table', () => {
    expect(isAddableColumnDefinition('TEXT PRIMARY KEY')).toBe(false);
    expect(isAddableColumnDefinition('TEXT NOT NULL UNIQUE')).toBe(false);
    expect(isAddableColumnDefinition('TEXT NOT NULL')).toBe(false); // no DEFAULT
    expect(isAddableColumnDefinition('TEXT DEFAULT CURRENT_TIMESTAMP')).toBe(false);
    expect(isAddableColumnDefinition('INTEGER DEFAULT (1 + 2)')).toBe(false);
    expect(isAddableColumnDefinition('TEXT GENERATED ALWAYS AS (1)')).toBe(false);
  });
});

describe('column healing plan', () => {
  /** The `sections` table as an older Worker created it (before migration 0005). */
  const STALE_SECTIONS_SQL = `CREATE TABLE sections (
    id               TEXT PRIMARY KEY,
    test_version_id  TEXT NOT NULL REFERENCES test_versions (id) ON DELETE CASCADE,
    skill            TEXT NOT NULL CHECK (skill IN ('READING', 'LISTENING', 'WRITING')),
    order_index      INTEGER NOT NULL DEFAULT 0,
    title            TEXT NOT NULL DEFAULT '',
    subtitle         TEXT,
    instructions     TEXT NOT NULL DEFAULT '',
    passage_id       TEXT REFERENCES passages (id) ON DELETE SET NULL,
    audio_asset_id   TEXT REFERENCES assets (id) ON DELETE SET NULL,
    duration_seconds INTEGER,
    config_json      TEXT NOT NULL DEFAULT '{}',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  )`;

  function planHeals(actualSqlByTable: Map<string, string>): { statement: string; table: string; column: string }[] {
    const plan: { statement: string; table: string; column: string }[] = [];
    for (const [table, expectedColumns] of runtimeExpectedColumns()) {
      const actualSql = actualSqlByTable.get(table);
      if (actualSql === undefined) continue; // whole table missing: CREATE TABLE handles it
      const actual = new Set(parseCreateTableColumns(actualSql).map((column) => column.name.toLowerCase()));
      for (const column of expectedColumns) {
        if (actual.has(column.name.toLowerCase())) continue;
        plan.push({
          statement: `ALTER TABLE "${table}" ADD COLUMN ${column.name} ${column.definition}`,
          table,
          column: column.name,
        });
      }
    }
    return plan;
  }

  it('produces exactly the migration-0005 ALTERs for a stale sections table', () => {
    const plan = planHeals(new Map([['sections', STALE_SECTIONS_SQL]]));
    const sectionHeals = plan.filter((heal) => heal.table === 'sections');
    expect(sectionHeals.map((heal) => heal.column).sort()).toEqual(
      ['description', 'image_asset_id', 'label', 'transcript_json', 'type'].sort(),
    );
    const label = sectionHeals.find((heal) => heal.column === 'label')!;
    expect(label.statement).toBe(`ALTER TABLE "sections" ADD COLUMN label TEXT NOT NULL DEFAULT ''`);
    // Every planned statement must survive SQLite's ADD COLUMN restrictions.
    for (const heal of plan) {
      const definition = heal.statement.replace(/^ALTER TABLE "[a-z_]+" ADD COLUMN [A-Za-z_]+ /, '');
      expect(isAddableColumnDefinition(definition), heal.statement).toBe(true);
    }
  });

  it('plans nothing for a database that already matches the runtime schema', () => {
    const actual = new Map(runtimeTableStatements());
    expect(planHeals(actual)).toHaveLength(0);
  });

  it('runs columns before indexes: the exact production failure order', () => {
    // A faithful-enough SQLite: CREATE INDEX fails on a missing column, ALTER
    // fails on a missing table/column, and CREATE TABLE registers its columns.
    const tables = new Map<string, Set<string>>();
    const indexes: string[] = [];
    const exec = (statement: string): void => {
      if (/^CREATE TABLE IF NOT EXISTS/i.test(statement)) {
        const name = /CREATE TABLE IF NOT EXISTS\s+"?([A-Za-z0-9_]+)"?/i.exec(statement)?.[1];
        if (!name) throw new Error(`unparseable create: ${statement.slice(0, 60)}`);
        if (!tables.has(name)) {
          tables.set(name, new Set(parseCreateTableColumns(statement).map((column) => column.name.toLowerCase())));
        }
        return;
      }
      if (/^ALTER TABLE/i.test(statement)) {
        const match = /^ALTER TABLE "?([A-Za-z0-9_]+)"? ADD COLUMN ([A-Za-z0-9_]+)/i.exec(statement);
        if (!match?.[1] || !match[2]) throw new Error(`unparseable alter: ${statement.slice(0, 60)}`);
        const [table, column] = [match[1], match[2]];
        const columns = tables.get(table);
        if (!columns) throw new Error(`no such table: ${table}`);
        if (columns.has(column.toLowerCase())) throw new Error(`duplicate column: ${column}`);
        columns.add(column.toLowerCase());
        return;
      }
      if (/^CREATE (UNIQUE )?INDEX/i.test(statement)) {
        const target = /ON\s+"?([A-Za-z0-9_]+)"?\s*\(([^)]+)\)/i.exec(statement);
        if (!target?.[1] || !target[2]) throw new Error(`unparseable index: ${statement.slice(0, 60)}`);
        const columns = tables.get(target[1]);
        if (!columns) throw new Error(`no such table: ${target[1]}`);
        for (const indexed of target[2].split(',')) {
          const column = indexed.trim().replace(/\s+(DESC|ASC)$/i, '');
          if (!columns.has(column.toLowerCase())) {
            throw new Error(`no such column: ${column}`); // the production failure
          }
        }
        indexes.push(statement);
        return;
      }
      throw new Error(`unexpected statement: ${statement.slice(0, 60)}`);
    };

    // 1. The stale production-like state.
    exec(STALE_SECTIONS_SQL.replace('CREATE TABLE sections', 'CREATE TABLE IF NOT EXISTS sections'));

    // 2. Heal in dependency order: columns, then missing tables, then indexes.
    //    Only `sections` exists so far, so only it can need column heals.
    for (const heal of planHeals(new Map([['sections', STALE_SECTIONS_SQL]]))) exec(heal.statement);
    for (const [name, statement] of runtimeTableStatements()) {
      if (!tables.has(name)) exec(statement);
    }
    for (const statement of runtimeIndexStatements()) exec(statement);

    // 3. Every runtime table and index now exists; idx_sections_image in
    // particular — the statement that used to abort the whole batch.
    expect(tables.size).toBe(schemaTableNames().length);
    expect(indexes.length).toBe(splitSqlStatements(schemaSql).filter((statement) => /^CREATE (UNIQUE )?INDEX/i.test(statement)).length);
    expect(tables.get('sections')!.has('image_asset_id')).toBe(true);
    expect(tables.get('sections')!.has('label')).toBe(true);
    expect(tables.has('attempt_sections')).toBe(true);
    expect(tables.has('vocabulary_entries')).toBe(true);
  });
});

/**
 * The second schema-drift failure: "The AI provider could not mark this
 * response." A database bootstrapped before migration 0007 keeps
 * `CHECK (scoring_source IN ('TEACHER', 'ADMIN', 'IMPORTED'))` because column
 * healing is ADD COLUMN only, so the AI grader's `INSERT … 'AI'` was rejected
 * even though the provider had answered. The table is now rebuilt in place.
 */
const STALE_WRITING_SCORES_SQL = `CREATE TABLE writing_scores (
  id                    TEXT PRIMARY KEY,
  writing_submission_id TEXT NOT NULL UNIQUE REFERENCES writing_submissions (id) ON DELETE CASCADE,
  band                  REAL,
  criteria_json         TEXT NOT NULL DEFAULT '{}',
  feedback              TEXT NOT NULL DEFAULT '',
  scoring_source        TEXT NOT NULL CHECK (scoring_source IN ('TEACHER', 'ADMIN', 'IMPORTED')),
  scored_by             TEXT REFERENCES users (id) ON DELETE SET NULL,
  scored_at             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
)`;

/** The slice of `node:sqlite`'s DatabaseSync this test uses. */
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { get(): unknown };
  close(): void;
}

describe('stale CHECK constraints', () => {
  const runtimeSql = new Map(runtimeTableStatements()).get('writing_scores')!;

  it('flags a writing_scores table that predates the AI source, and only that', () => {
    expect(staleConstraintTables(new Map([['writing_scores', STALE_WRITING_SCORES_SQL]]))).toEqual(['writing_scores']);
    expect(staleConstraintTables(new Map([['writing_scores', runtimeSql]]))).toEqual([]);
    // A table that does not exist is the missing-table path's business.
    expect(staleConstraintTables(new Map())).toEqual([]);
  });

  it('is satisfied by the table definition the Worker ships', () => {
    for (const rule of CHECK_REBUILDS) {
      const sql = new Map(runtimeTableStatements()).get(rule.table);
      expect(sql, rule.table).toBeDefined();
      expect(rule.requires.test(sql!), `${rule.table}: ${rule.why}`).toBe(true);
    }
  });

  it('recognises a CHECK failure but not other database errors', () => {
    expect(isCheckConstraintError(new Error('D1_ERROR: CHECK constraint failed: scoring_source IN (...): SQLITE_CONSTRAINT'))).toBe(true);
    expect(isCheckConstraintError(new Error('D1_ERROR: no such table: writing_scores'))).toBe(false);
    expect(isCheckConstraintError(undefined)).toBe(false);
  });

  it('builds a copy-then-swap rebuild that names only shared columns', () => {
    const sql: string[] = [];
    const env = { DB: { prepare: (statement: string) => (sql.push(statement), { statement }) } } as never;
    rebuildStatements(env, 'writing_scores', runtimeSql, STALE_WRITING_SCORES_SQL);

    expect(sql[0]).toBe('PRAGMA defer_foreign_keys = ON');
    expect(sql.some((statement) => /^CREATE TABLE "writing_scores__rebuild"/.test(statement))).toBe(true);
    expect(sql.find((statement) => statement.startsWith('INSERT INTO'))).toBe(
      'INSERT INTO "writing_scores__rebuild" ("id", "writing_submission_id", "band", "criteria_json", "feedback", "scoring_source", "scored_by", "scored_at", "created_at", "updated_at") SELECT "id", "writing_submission_id", "band", "criteria_json", "feedback", "scoring_source", "scored_by", "scored_at", "created_at", "updated_at" FROM "writing_scores"',
    );
    // Copy happens before the old table is dropped, and the rename comes last.
    const index = (pattern: RegExp) => sql.findIndex((statement) => pattern.test(statement));
    expect(index(/^INSERT INTO/)).toBeLessThan(index(/^DROP TABLE "writing_scores"$/));
    expect(index(/^DROP TABLE "writing_scores"$/)).toBeLessThan(index(/RENAME TO "writing_scores"$/));
    expect(sql.at(-1)).toBe('ALTER TABLE "writing_scores__rebuild" RENAME TO "writing_scores"');
  });

  // Runs the generated statements against a real SQLite engine (Node 22+ ships
  // one); older Node versions skip it rather than fail.
  it('rebuilds a stale table on a real SQLite engine without losing a row', async () => {
    // A computed specifier keeps TypeScript (older @types/node) from resolving it.
    const specifier = 'node:sqlite';
    const sqlite = (await import(/* @vite-ignore */ specifier).catch(() => null)) as {
      DatabaseSync: new (path: string) => SqliteDb;
    } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE writing_submissions (id TEXT PRIMARY KEY)');
    db.exec(STALE_WRITING_SCORES_SQL);
    db.exec('CREATE INDEX idx_writing_scores_source ON writing_scores (scoring_source)');
    db.exec("INSERT INTO users VALUES ('u1')");
    db.exec("INSERT INTO writing_submissions VALUES ('s1'), ('s2')");
    db.exec(
      "INSERT INTO writing_scores VALUES ('a', 's1', 6.5, '{\"TASK_ACHIEVEMENT\":6}', 'Teacher note', 'TEACHER', 'u1', 't', 't', 't')",
    );

    // 1. The bug: the AI source is refused.
    const insertAi = "INSERT INTO writing_scores VALUES ('b', 's2', 7, '{}', 'AI note', 'AI', NULL, 't', 't', 't')";
    expect(() => db.exec(insertAi)).toThrow(/CHECK constraint failed/);

    // 2. The heal, exactly as `healSchema` batches it (a batch is one transaction).
    const sql: string[] = [];
    const env = { DB: { prepare: (statement: string) => (sql.push(statement), { statement }) } } as never;
    rebuildStatements(env, 'writing_scores', runtimeSql, STALE_WRITING_SCORES_SQL);
    db.exec('BEGIN');
    for (const statement of sql) db.exec(statement);
    db.exec('COMMIT');

    // 3. The old row survived untouched and the AI row is now accepted.
    expect(db.prepare("SELECT band, feedback, scoring_source, scored_by FROM writing_scores WHERE id = 'a'").get()).toMatchObject({
      band: 6.5,
      feedback: 'Teacher note',
      scoring_source: 'TEACHER',
      scored_by: 'u1',
    });
    expect(() => db.exec(insertAi)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM writing_scores').get()).toEqual({ n: 2 });
    // The table is recognised as current afterwards.
    const live = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'writing_scores'").get() as { sql: string };
    expect(staleConstraintTables(new Map([['writing_scores', live.sql]]))).toEqual([]);
    // The foreign key to the submission still works.
    expect(() => db.exec("INSERT INTO writing_scores VALUES ('c', 'nope', 1, '{}', '', 'AI', NULL, 't', 't', 't')")).toThrow(/FOREIGN KEY/);
    db.close();
  });
});
