import type { Env } from '../env';
// Generated file — see scripts/generate-runtime-schema.mjs (`npm run schema:generate`).
import RUNTIME_SCHEMA_SQL from './runtime-schema.sql';
import { ensureDefaultScoringProfiles } from '../services/scoring-profile-service';

/**
 * Self-healing schema bootstrap.
 *
 * A deployed Worker whose D1 database never had `wrangler d1 migrations apply
 * DB --remote` run against it fails *every* database query with
 * `D1_ERROR: no such table: users`. Worse, a database that was initialised by
 * an *older* Worker version then drifts out of sync: newer code expects
 * columns that the old tables do not have (`D1_ERROR: no such column:
 * sec.label`), and `CREATE INDEX ... ON sections (image_asset_id)` inside the
 * bootstrap batch aborts the whole transaction — so even brand-new tables
 * (attempt_sections, vocabulary_entries) were never created. That produced the
 * permanent `503 "The platform database is not initialised yet"` on
 * `/api/student/dashboard`.
 *
 * The bootstrap therefore heals TWO kinds of drift, once per isolate:
 *   1. missing columns on existing tables  -> `ALTER TABLE … ADD COLUMN …`;
 *   2. missing tables                      -> `CREATE TABLE IF NOT EXISTS …`;
 * and only then re-runs the (idempotent) index statements — last, because an
 * index on a column that (1)/(2) just created would otherwise abort the batch.
 *
 * Guarantees:
 *   - read-only probe first; when the schema is current the cost is one tiny
 *     `SELECT … FROM sqlite_master` per isolate, then zero further queries;
 *   - every statement is additive and idempotent (`IF NOT EXISTS`, or an
 *     `ADD COLUMN` for a column proven absent), so nothing that already
 *     exists is ever altered, renamed or dropped, and existing rows are
 *     never touched;
 *   - column definitions that SQLite cannot `ADD COLUMN` (PRIMARY KEY /
 *     UNIQUE / NOT NULL without DEFAULT / non-constant DEFAULT) are skipped
 *     with a logged warning instead of failing the batch;
 *   - failures are logged and never thrown: a genuine database outage still
 *     produces the normal error path instead of a confusing "schema" error,
 *     and a failed attempt is NOT cached, so the very next request retries.
 */

/** Tables the authentication path cannot work without. */
export const CORE_TABLES = [
  'users',
  'user_profiles',
  'sessions',
  'rate_limit_counters',
  'login_attempts',
  'platform_settings',
  'admin_audit_logs',
] as const;

export interface SchemaReport {
  /** Tables that exist in the bound database. */
  present: string[];
  /** Application tables from the runtime schema that are missing. */
  missing: string[];
  /** `table.column` pairs the runtime schema expects but the database lacks. */
  missingColumns?: string[];
  /** True when nothing had to be created. */
  complete: boolean;
  /** Set when the bootstrap created the missing tables during this call. */
  created?: string[];
  /** Columns added to existing tables during this call. */
  addedColumns?: string[];
  error?: string;
}

export const MISSING_SCHEMA_HINT =
  'The platform database is missing tables or columns. Deploy this Worker (its bootstrap creates them automatically on the first request), run `npx wrangler d1 migrations apply DB --remote` on a fresh database, or POST /api/admin/system/schema/repair as an admin.';

interface SchemaState {
  ok: boolean;
  error?: string;
}

// One check per isolate. A Worker isolate serves many requests, so this keeps
// the happy path free of extra round trips while still healing a fresh or
// drifted database within one request of the first deploy.
let schemaState: Promise<SchemaState> | null = null;

/**
 * Resolves once the core tables are known to exist. Safe to call on every
 * request; it never throws.
 */
export function ensureSchema(env: Env): Promise<SchemaState> {
  if (!schemaState) {
    schemaState = checkAndBootstrap(env).then(
      (state) => {
        // A failed bootstrap must not be cached for the isolate's lifetime:
        // the next request retries (a transient D1 error should not turn into
        // a permanent outage).
        if (!state.ok) schemaState = null;
        return state;
      },
      (error: unknown) => {
        schemaState = null;
        const message = (error as Error)?.message ?? String(error);
        console.error('schema_bootstrap_failed', message);
        return { ok: false, error: message } satisfies SchemaState;
      },
    );
  }
  return schemaState;
}

/** Drops the per-isolate cache (used by tests and by the admin repair route). */
export function resetSchemaState(): void {
  schemaState = null;
}

async function checkAndBootstrap(env: Env): Promise<SchemaState> {
  const drift = await schemaDrift(env);
  if (drift.missingTables.length === 0 && drift.missingColumns.length === 0) {
    await ensureDefaultScoringProfiles(env);
    return { ok: true };
  }

  if (drift.missingTables.length > 0) {
    console.warn('schema_bootstrap', `missing tables: ${drift.missingTables.join(', ')}`);
  }
  if (drift.missingColumns.length > 0) {
    console.warn('schema_bootstrap', `missing columns: ${drift.missingColumns.join(', ')}`);
  }
  await healSchema(env, drift);
  await ensureDefaultScoringProfiles(env);
  return { ok: true };
}

/**
 * Adds what the database lacks, in one transactional batch, in dependency
 * order: columns first (so indexes on them can be created), then tables,
 * then every index statement (idempotent; creates any whose column was just
 * added). Aborting the batch leaves the database exactly as it was.
 */
async function healSchema(env: Env, drift: SchemaDrift): Promise<void> {
  const tableSql = new Map(runtimeTableStatements());
  const statements: D1PreparedStatement[] = [];

  for (const heal of drift.columnStatements) {
    statements.push(env.DB.prepare(heal));
  }
  for (const table of drift.missingTables) {
    const sql = tableSql.get(table);
    if (sql) statements.push(env.DB.prepare(sql));
  }
  for (const index of runtimeIndexStatements()) {
    statements.push(env.DB.prepare(index));
  }

  if (statements.length > 0) await env.DB.batch(statements);
}

/** What the bound database is missing, compared with the runtime schema. */
export interface SchemaDrift {
  /** Application tables from the runtime schema that do not exist. */
  missingTables: string[];
  /** `table.column` pairs the runtime schema expects but the database lacks. */
  missingColumns: string[];
  /**
   * Ready-to-run `ALTER TABLE … ADD COLUMN` statements that repair
   * `missingColumns`. Columns that SQLite cannot add to an existing table are
   * reported in `unhealableColumns` and never generated.
   */
  columnStatements: string[];
  /** Columns detected as missing but not safely addable via ALTER. */
  unhealableColumns: string[];
}

/** Full drift report against a live database. Never throws. */
export async function schemaDrift(env: Env): Promise<SchemaDrift> {
  const existing = await existingTableSql(env);
  const expected = runtimeExpectedColumns();

  const missingTables = [...expected.keys()].filter((table) => !existing.has(table));
  const missingColumns: string[] = [];
  const columnStatements: string[] = [];
  const unhealableColumns: string[] = [];

  for (const [table, columns] of expected) {
    const createSql = existing.get(table);
    if (createSql === undefined) continue; // whole table is missing instead
    const actual = parseCreateTableColumns(createSql);
    const actualNames = new Set(actual.map((column) => column.name.toLowerCase()));
    for (const column of columns) {
      if (actualNames.has(column.name.toLowerCase())) continue;
      missingColumns.push(`${table}.${column.name}`);
      if (isAddableColumnDefinition(column.definition)) {
        columnStatements.push(`ALTER TABLE "${table}" ADD COLUMN ${column.name} ${column.definition}`);
      } else {
        unhealableColumns.push(`${table}.${column.name}`);
      }
    }
  }

  if (unhealableColumns.length > 0) {
    console.warn(
      'schema_bootstrap',
      `columns that cannot be added automatically (need a table rebuild): ${unhealableColumns.join(', ')}`,
    );
  }

  return { missingTables, missingColumns, columnStatements, unhealableColumns };
}

/** Application tables from the runtime schema that the database does not have. */
export async function missingTables(env: Env): Promise<string[]> {
  return (await schemaDrift(env)).missingTables;
}

/**
 * Every table currently in the bound database, mapped to its `CREATE TABLE`
 * SQL (empty map when the database is unreachable). The SQL text is what lets
 * the drift check compare columns without relying on PRAGMA support.
 */
export async function existingTableSql(env: Env): Promise<Map<string, string>> {
  const rows = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL")
    .all<{ name: string; sql: string }>();
  return new Map(rows.results.map((row) => [row.name, row.sql]));
}

/** Full report for the admin diagnostics screen; also repairs in place. */
export async function schemaReport(env: Env): Promise<SchemaReport> {
  try {
    const expected = [...runtimeExpectedColumns().keys()];
    const before = await schemaDrift(env);
    if (before.missingTables.length === 0 && before.missingColumns.length === 0) {
      await ensureDefaultScoringProfiles(env);
      return {
        present: expected,
        missing: [],
        missingColumns: [],
        complete: true,
      };
    }

    await healSchema(env, before);

    const after = await schemaDrift(env);
    resetSchemaState();
    await ensureDefaultScoringProfiles(env);
    return {
      present: expected.filter((table) => !after.missingTables.includes(table)),
      missing: after.missingTables,
      missingColumns: after.missingColumns,
      complete: after.missingTables.length === 0 && after.missingColumns.length === 0,
      created: before.missingTables.filter((table) => !after.missingTables.includes(table)),
      addedColumns: before.missingColumns.filter((column) => !after.missingColumns.includes(column)),
    };
  } catch (error) {
    return {
      present: [],
      missing: [...runtimeExpectedColumns().keys()],
      complete: false,
      error: (error as Error)?.message ?? String(error),
    };
  }
}

/** Is the failure we just saw the "database has no tables" failure? */
export function isMissingSchemaError(error: unknown): boolean {
  const message = `${(error as Error)?.message ?? error ?? ''}`;
  return /no such table/i.test(message) || /no such column/i.test(message);
}

/** Table names declared by the runtime schema, in dependency order. */
export function schemaTableNames(): string[] {
  return [...RUNTIME_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS\s+"?([A-Za-z0-9_]+)"?/g)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

// -----------------------------------------------------------------------------
// Column-level drift: parsing and planning
// -----------------------------------------------------------------------------

export interface TableColumn {
  name: string;
  /** Everything after the column name, verbatim (type, constraints, comments). */
  definition: string;
}

/** Table-constraint keywords that start a non-column clause inside CREATE TABLE. */
const TABLE_CONSTRAINT_KEYWORDS = new Set(['CONSTRAINT', 'UNIQUE', 'CHECK', 'PRIMARY', 'FOREIGN']);

/** `CREATE TABLE` statements from the runtime script, as `[tableName, sql]`. */
export function runtimeTableStatements(): [string, string][] {
  return splitSqlStatements(RUNTIME_SCHEMA_SQL)
    .filter((statement) => /^CREATE TABLE IF NOT EXISTS/i.test(statement))
    .map((statement) => {
      const name = schemaTableNamesFromCreate(statement);
      return name ? ([name, statement] as [string, string]) : null;
    })
    .filter((entry): entry is [string, string] => entry !== null);
}

/** `CREATE [UNIQUE] INDEX` statements from the runtime script. */
export function runtimeIndexStatements(): string[] {
  return splitSqlStatements(RUNTIME_SCHEMA_SQL).filter((statement) =>
    /^CREATE (UNIQUE )?INDEX IF NOT EXISTS/i.test(statement),
  );
}

/**
 * Expected columns per table, parsed once from the runtime schema.
 * Memoised per isolate: the script is immutable at runtime.
 */
let expectedColumnsCache: Map<string, TableColumn[]> | null = null;
export function runtimeExpectedColumns(): Map<string, TableColumn[]> {
  if (!expectedColumnsCache) {
    expectedColumnsCache = new Map<string, TableColumn[]>();
    for (const [table, sql] of runtimeTableStatements()) {
      expectedColumnsCache.set(table, parseCreateTableColumns(sql));
    }
  }
  return expectedColumnsCache;
}

/** Extracts the table name from a `CREATE TABLE IF NOT EXISTS …` statement. */
function schemaTableNamesFromCreate(statement: string): string | null {
  const match = /CREATE TABLE IF NOT EXISTS\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z0-9_]+)"?/i.exec(statement);
  return match?.[1] ?? null;
}

/**
 * Parses the column list of a `CREATE TABLE … ( … )` statement.
 *
 * The generated runtime schema (and the hand-written migrations it mirrors)
 * uses plain, regular formatting, but the parser still respects quoting
 * (`"x"`, `` `x` ``, `[x]`, `'str'`), nested parentheses, and `--` and
 * slash-star block comments, so a comma inside any of them cannot split a
 * column. Entries that
 * start with a table-constraint keyword (PRIMARY KEY, UNIQUE (…), CHECK (…),
 * FOREIGN KEY (…), CONSTRAINT name …) are skipped.
 */
export function parseCreateTableColumns(createSql: string): TableColumn[] {
  const open = createSql.indexOf('(');
  const close = createSql.lastIndexOf(')');
  if (open === -1 || close <= open) return [];

  // Comments carry no schema meaning, and a `-- note, with commas` between two
  // columns must not hide the next column's name — strip them before parsing.
  const body = stripSqlComments(createSql.slice(open + 1, close));

  const columns: TableColumn[] = [];
  for (const part of splitTopLevel(body)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = /^"([^"]+)"|^\[([^\]]+)\]|^`([^`]+)`|^([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (!name) continue;
    const firstWord = (name.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? name).toUpperCase();
    if (TABLE_CONSTRAINT_KEYWORDS.has(firstWord)) continue;
    columns.push({ name, definition: trimmed.slice(match[0].length).trim() });
  }
  return columns;
}

/**
 * Removes `-- line` and slash-star block comments from SQL text, replacing
 * each with a single space. Quote-aware: a `--` inside a string literal,
 * quoted identifier or [bracketed name] is left alone.
 */
export function stripSqlComments(sql: string): string {
  let result = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      const stop = end === -1 ? sql.length : end;
      result += ' ';
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      result += ' ';
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      result += char;
      index += 1;
      while (index < sql.length) {
        const value = sql[index];
        result += value;
        index += 1;
        if (value === quote) {
          if (sql[index] === quote) {
            result += quote;
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (char === '[') {
      const end = sql.indexOf(']', index + 1);
      const stop = end === -1 ? sql.length : end + 1;
      result += sql.slice(index, stop);
      index = stop;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

/**
 * Can this column definition be appended to an existing table with
 * `ALTER TABLE … ADD COLUMN`? SQLite forbids PRIMARY KEY and UNIQUE, NOT NULL
 * without a non-NULL DEFAULT, and non-constant DEFAULTs; such columns are
 * skipped (with a warning) rather than allowed to abort the healing batch.
 */
export function isAddableColumnDefinition(definition: string): boolean {
  const sql = definition.replace(/'[^']*'/g, "''"); // neutralise string literals
  if (/\bPRIMARY\s+KEY\b/i.test(sql) || /\bUNIQUE\b/i.test(sql)) return false;
  if (/\bGENERATED\s+ALWAYS\b/i.test(sql)) return false; // generated columns cannot be appended
  if (/\bNOT\s+NULL\b/i.test(sql) && !/\bDEFAULT\b/i.test(sql)) return false;
  if (/\bDEFAULT\s+(CURRENT_(TIMESTAMP|DATE|TIME)|\()/i.test(sql)) return false;
  return true;
}

/**
 * Splits a `CREATE TABLE` column list at top-level commas. Like
 * {@link splitSqlStatements}, it keeps comments and quoted text intact so a
 * comma inside `-- note`, `CHECK (x IN ('a', 'b'))` or a string literal
 * cannot split a column definition.
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '-' && next === '-') {
      const end = input.indexOf('\n', index);
      const stop = end === -1 ? input.length : end + 1;
      current += input.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = input.indexOf('*/', index + 2);
      const stop = end === -1 ? input.length : end + 2;
      current += input.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      current += char;
      index += 1;
      while (index < input.length) {
        const value = input[index];
        current += value;
        index += 1;
        if (value === quote) {
          if (input[index] === quote) {
            current += quote;
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (char === '[') {
      const end = input.indexOf(']', index + 1);
      const stop = end === -1 ? input.length : end + 1;
      current += input.slice(index, stop);
      index = stop;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }

  parts.push(current);
  return parts;
}

/**
 * Splits a SQL script into individual statements.
 *
 * D1 executes one statement per prepared query, and the generated script is a
 * plain sequence of `CREATE ...;` statements. Comments (`--`, block) and string
 * literals are respected so a semicolon inside either cannot split a statement.
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  const length = script.length;
  while (index < length) {
    const char = script[index];
    const next = script[index + 1];

    if (char === '-' && next === '-') {
      const end = script.indexOf('\n', index);
      index = end === -1 ? length : end + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = script.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      current += char;
      index += 1;
      while (index < length) {
        const value = script[index];
        current += value;
        index += 1;
        if (value === '\\' && quote !== "'") {
          // Backslash escapes are not SQL, but keep them verbatim if present.
          current += script[index] ?? '';
          index += 1;
          continue;
        }
        if (value === quote) {
          if (script[index] === quote) {
            // SQL doubled quote = escaped literal quote.
            current += quote;
            index += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }
    if (char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Human-readable hint attached to 503s caused by an un-initialised database. */
export function missingSchemaMessage(missing: string[]): string {
  return `Database schema is not initialised (missing: ${missing.slice(0, 8).join(', ')}${
    missing.length > 8 ? ', …' : ''
  }). ${MISSING_SCHEMA_HINT}`;
}
