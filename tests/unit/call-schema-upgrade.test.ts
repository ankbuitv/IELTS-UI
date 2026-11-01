import { describe, expect, it } from 'vitest';
import schemaSql from '@worker/lib/runtime-schema.sql';
import { ensureSchema, resetSchemaState, schemaDrift } from '@worker/lib/ensure-schema';
import type { Env } from '@worker/env';

interface Statement { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function adapter(db: SqliteDb) {
  type Bound = { bind: (...values: unknown[]) => Bound; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }>; run: () => Promise<unknown> };
  return {
    prepare(sql: string): Bound { let params: unknown[] = [];
      const bound: Bound = { bind(...values) { params = values; return bound; },
        async first<T>() { return (db.prepare(sql).get(...params) as T | undefined) ?? null; },
        async all<T>() { return { results: db.prepare(sql).all(...params) as T[] }; },
        async run() { return db.prepare(sql).run(...params); } }; return bound;
    },
    async batch(statements: Bound[]) {
      db.exec('BEGIN'); try { for (const stmt of statements) await stmt.run(); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

describe('self-healing deployed call schema', () => {
  it('upgrades old signalling table and keeps data before serving calls', async () => {
    const specifier = 'node:sqlite';
    const sqlite = await import(/* @vite-ignore */ specifier).catch(() => null) as { DatabaseSync: new (path: string) => SqliteDb } | null;
    if (!sqlite) return;
    const db = new sqlite.DatabaseSync(':memory:');
    try {
      db.exec(schemaSql);
      db.exec(`PRAGMA foreign_keys = OFF; DROP TABLE mentor_signals;
        CREATE TABLE mentor_signals (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sender_id TEXT NOT NULL, target_id TEXT,
          room_key TEXT NOT NULL DEFAULT 'main', kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE INDEX idx_mentor_signals_session ON mentor_signals(session_id,room_key,created_at);
        INSERT INTO mentor_signals VALUES ('sig_z','room','sender','recipient','main','OFFER','test','2026-01-01');`);
      const env = { DB: adapter(db) } as unknown as Env;
      const old = await schemaDrift(env);
      expect(old.unhealableColumns).toContain('mentor_signals.seq');
      expect(old.staleConstraints).toContain('mentor_signals');
      resetSchemaState();
      await expect(ensureSchema(env)).resolves.toEqual({ ok: true });
      const fixed = await schemaDrift(env);
      expect(fixed.missingColumns).not.toContain('mentor_signals.seq');
      expect(fixed.staleConstraints).not.toContain('mentor_signals');
      expect(db.prepare("SELECT seq,id,payload FROM mentor_signals WHERE id='sig_z'").get()).toMatchObject({ seq: 1, id: 'sig_z', payload: 'test' });
      db.exec("INSERT INTO mentor_signals (id,session_id,sender_id,kind,payload,created_at) VALUES ('sig_next','room','sender','HAND','up','2026-01-02')");
      expect(db.prepare("SELECT seq FROM mentor_signals WHERE id='sig_next'").get()).toEqual({ seq: 2 });
    } finally { resetSchemaState(); db.close(); }
  });
});
