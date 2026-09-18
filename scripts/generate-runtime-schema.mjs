#!/usr/bin/env node
/**
 * Regenerates `src/worker/lib/runtime-schema.sql`.
 *
 * The Worker carries an idempotent copy of the *final* database schema so it can
 * create any table that is missing the first time it runs against an
 * un-initialised D1 database (see `src/worker/lib/ensure-schema.ts`). Without
 * it, a database whose migrations were never applied answers every query with
 * `D1_ERROR: no such table: users` and the API returns a bare 500.
 *
 * This script is the single source of truth for that copy: it replays every
 * file in `migrations/` into an in-memory SQLite database (the same engine D1
 * uses) and writes out only the resulting `CREATE TABLE` / `CREATE INDEX`
 * statements, rewritten with `IF NOT EXISTS`.
 *
 * Run it after adding or editing a migration:
 *
 *   npm run schema:generate
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const migrationsDir = `${root}/migrations`;
const outFile = `${root}/src/worker/lib/runtime-schema.sql`;

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (migrationFiles.length === 0) {
  console.error(`No .sql files found in ${migrationsDir}.`);
  process.exit(1);
}

// D1 executes with foreign keys OFF, which is what lets migration 0003 rebuild
// the `assets` table. Match that here so the replay produces the same schema.
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = OFF;');

for (const file of migrationFiles) {
  db.exec(readFileSync(`${migrationsDir}/${file}`, 'utf8'));
  console.log(`  ✓ ${file}`);
}

const rows = db
  .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
  .all();

const statements = [];
const seen = new Set();

for (const row of rows) {
  if (row.type !== 'table' && row.type !== 'index') continue;
  // Bookkeeping tables belong to wrangler/miniflare, not to the application.
  if (row.name === 'd1_migrations' || row.name === '_cf_METADATA') continue;
  if (row.name.startsWith('sqlite_')) continue;
  if (row.name.startsWith('sqlite_autoindex')) continue;

  const statement = withIfNotExists(row.sql.trim());
  if (seen.has(statement)) continue;
  seen.add(statement);
  statements.push({ kind: row.type, name: row.name, statement });
}

const tables = statements.filter((entry) => entry.kind === 'table');
const indexes = statements.filter((entry) => entry.kind === 'index');

const header = `-- =============================================================================
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run schema:generate
--
-- Idempotent copy of the final schema produced by replaying migrations/
-- (${migrationFiles.join(', ')}). The Worker runs this once per isolate against
-- an un-initialised database so a deployment cannot end up in a state where
-- every request fails with "no such table".
--
-- Tables: ${tables.length}   Indexes: ${indexes.length}
-- =============================================================================

`;

const body =
  tables
    .map((entry) => `-- table: ${entry.name}\n${entry.statement};`)
    .join('\n\n') +
  '\n\n' +
  indexes.map((entry) => `-- index: ${entry.name}\n${entry.statement};`).join('\n\n') +
  '\n';

mkdirSync(`${root}/src/worker/lib`, { recursive: true });
writeFileSync(outFile, header + body);

console.log(
  `\n✓ Wrote ${outFile.replace(root + '/', '')} (${tables.length} tables, ${indexes.length} indexes)`,
);

/** `CREATE TABLE x` -> `CREATE TABLE IF NOT EXISTS x` (idempotent replay). */
function withIfNotExists(sql) {
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i.test(sql)) return sql;
  if (/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(sql)) return sql;
  return sql.replace(/^CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)/i, (_match, keyword) =>
    keyword.toUpperCase().startsWith('UNIQUE')
      ? 'CREATE UNIQUE INDEX IF NOT EXISTS'
      : keyword.toUpperCase() === 'INDEX'
        ? 'CREATE INDEX IF NOT EXISTS'
        : 'CREATE TABLE IF NOT EXISTS',
  );
}
