import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { CORE_TABLES, isMissingSchemaError, schemaTableNames, splitSqlStatements } from '@worker/lib/ensure-schema';

/**
 * The runtime schema is what lets a Worker recover from an un-initialised D1
 * database (the failure mode behind `POST /api/auth/register` returning a bare
 * 500). These tests keep the generated file and the splitter that feeds it to
 * D1 honest: a mis-split statement is a failed deploy.
 */
describe('runtime schema', () => {
  const statements = splitSqlStatements(schemaSql);

  it('is a non-trivial, complete copy of the schema', () => {
    const tables = schemaTableNames();
    expect(tables.length).toBeGreaterThanOrEqual(30);
    expect(statements.length).toBe(tables.length + (schemaSql.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length);
  });

  it('declares every table the authentication path depends on', () => {
    const tables = new Set(schemaTableNames());
    for (const table of CORE_TABLES) expect(tables.has(table)).toBe(true);
  });

  it('is idempotent: every statement creates something and destroys nothing', () => {
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /);
      // `ON DELETE CASCADE` is legitimate; a destructive *statement* is not.
      expect(statement).not.toMatch(/^\s*(DROP|ALTER|DELETE|UPDATE|INSERT|PRAGMA)\b/i);
    }
  });

  it('splits into exactly the statements the script declares', () => {
    // `-- table:` / `-- index:` comments mark one statement each.
    const declared = (schemaSql.match(/^-- (table|index): /gm) ?? []).length;
    expect(statements.length).toBe(declared);
    // Nothing is left over and nothing is empty.
    for (const statement of statements) {
      expect(statement.trim().length).toBeGreaterThan(20);
      expect(statement.endsWith(';')).toBe(false);
    }
  });

  it('keeps semicolons inside comments and string literals inside one statement', () => {
    const script = `
      -- a leading comment; with a semicolon
      CREATE TABLE IF NOT EXISTS t (
        role TEXT CHECK (role IN ('A', 'B;C')), -- inline; comment
        note TEXT DEFAULT 'x;y'
      );
      /* block; comment */
      CREATE INDEX IF NOT EXISTS i ON t (role);
    `;
    expect(splitSqlStatements(script)).toHaveLength(2);
  });

  it('handles doubled quotes inside literals', () => {
    const script = `CREATE TABLE IF NOT EXISTS t (n TEXT DEFAULT 'it''s; fine');`;
    expect(splitSqlStatements(script)).toHaveLength(1);
  });
});

describe('isMissingSchemaError', () => {
  it('recognises the D1 "no such table" failure', () => {
    expect(isMissingSchemaError(new Error('D1_ERROR: no such table: rate_limit_counters: SQLITE_ERROR'))).toBe(true);
    expect(isMissingSchemaError(new Error('D1_ERROR: no such column: role'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isMissingSchemaError(new Error('D1_ERROR: UNIQUE constraint failed: users.email'))).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
  });
});
