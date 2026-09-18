import type { Env } from '../env';
import { newId, nowIso } from './ids';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Append-only audit trail for sensitive administrative operations. */
export async function recordAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO admin_audit_logs
        (id, actor_user_id, action, entity_type, entity_id, metadata_json, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId('aud'),
        entry.actorUserId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
        entry.userAgent ?? null,
        nowIso(),
      )
      .run();
  } catch (error) {
    // Auditing must never break the user-facing operation, but it must be visible.
    console.error('audit_write_failed', (error as Error).message);
  }
}
