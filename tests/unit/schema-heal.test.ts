import { describe, expect, it } from 'vitest';
import {
  isAddableColumnDefinition,
  parseCreateTableColumns,
  runtimeExpectedColumns,
  runtimeIndexStatements,
  runtimeTableStatements,
  schemaTableNames,
  splitSqlStatements,
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
