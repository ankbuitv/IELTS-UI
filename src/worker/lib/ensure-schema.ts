import type { Env } from '../env';
// Generated file — see scripts/generate-runtime-schema.mjs (`npm run schema:generate`).
import RUNTIME_SCHEMA_SQL from './runtime-schema.sql';

/**
 * Self-healing schema bootstrap.
 *
 * A deployed Worker whose D1 database never had `wrangler d1 migrations apply
 * DB --remote` run against it fails *every* database query with
 * `D1_ERROR: no such table: users`, which surfaced to candidates as an
 * unexplained `500` from `/api/auth/register`. The Worker therefore verifies the
 * core tables exist once per isolate and creates any that are missing, using an
 * idempotent copy of the final schema.
 *
 * Guarantees:
 *   - read-only probe first; when the tables are present the cost is one tiny
 *     `SELECT name FROM sqlite_master` per isolate, then zero further queries;
 *   - every statement is `CREATE TABLE|INDEX IF NOT EXISTS`, so nothing that
 *     already exists is ever altered, renamed or dropped, and existing rows are
 *     never touched;
 *   - failures are logged, never thrown: a genuine database outage still
 *     produces the normal error path instead of a confusing "schema" error.
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
  /** True when nothing had to be created. */
  complete: boolean;
  /** Set when the bootstrap created the missing tables during this call. */
  created?: string[];
  error?: string;
}

export const MISSING_SCHEMA_HINT =
  'The platform database has no tables yet. Run `npx wrangler d1 migrations apply DB --remote` (the Worker also creates them automatically on its first request).';

interface SchemaState {
  ok: boolean;
  error?: string;
}

// One check per isolate. A Worker isolate serves many requests, so this keeps
// the happy path free of extra round trips while still healing a fresh or
// newly created database within one request of the first deploy.
let schemaState: Promise<SchemaState> | null = null;

/**
 * Resolves once the core tables are known to exist. Safe to call on every
 * request; it never throws.
 */
export function ensureSchema(env: Env): Promise<SchemaState> {
  if (!schemaState) {
    schemaState = checkAndBootstrap(env).catch((error: unknown) => ({
      ok: false,
      error: (error as Error)?.message ?? String(error),
    }));
  }
  return schemaState;
}

/** Drops the per-isolate cache (used by tests and by the admin repair route). */
export function resetSchemaState(): void {
  schemaState = null;
}

async function checkAndBootstrap(env: Env): Promise<SchemaState> {
  const missing = await missingTables(env);
  if (missing.length === 0) return { ok: true };

  console.warn('schema_bootstrap', `missing tables: ${missing.join(', ')}`);
  const statements = splitSqlStatements(RUNTIME_SCHEMA_SQL);
  // D1 rejects multi-statement queries in a single prepare(), so the script is
  // executed statement by statement inside one batch (one HTTP round trip).
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
  return { ok: true };
}

/** Application tables from the runtime schema that the database does not have. */
export async function missingTables(env: Env): Promise<string[]> {
  const existing = await existingTables(env);
  return schemaTableNames().filter((table) => !existing.has(table));
}

/** Every table currently in the bound database (empty when it is unreachable). */
export async function existingTables(env: Env): Promise<Set<string>> {
  const rows = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

/** Full report for the admin diagnostics screen. */
export async function schemaReport(env: Env): Promise<SchemaReport> {
  try {
    const existing = await existingTables(env);
    const expected = schemaTableNames();
    const missing = expected.filter((table) => !existing.has(table));
    if (missing.length === 0) {
      resetSchemaState();
      return { present: expected.filter((table) => existing.has(table)), missing, complete: true };
    }
    const statements = splitSqlStatements(RUNTIME_SCHEMA_SQL);
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
    const after = await existingTables(env);
    resetSchemaState();
    return {
      present: expected.filter((table) => after.has(table)),
      missing: expected.filter((table) => !after.has(table)),
      complete: expected.every((table) => after.has(table)),
      created: missing.filter((table) => after.has(table)),
    };
  } catch (error) {
    return {
      present: [],
      missing: schemaTableNames(),
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
