/** Append-only audit trail for sensitive operations. */
import type { SqlExecutor } from '../db/driver';
import type { Database } from '../db/database';
import { newId } from '../core/ids';
import { nowIso } from '../core/dates';
import type { Actor } from '../core/permissions';
import type { AuditRow } from '../db/types';

export interface AuditInput {
  actor: Actor;
  action: string;
  entity?: string;
  entityId?: string;
  details?: unknown;
}

export async function audit(tx: SqlExecutor, input: AuditInput): Promise<void> {
  await tx.exec(
    `INSERT INTO audit_events (id, at, actor, action, entity, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId('aud'),
      nowIso(),
      `${input.actor.name} (${input.actor.role})`,
      input.action,
      input.entity ?? null,
      input.entityId ?? null,
      input.details === undefined ? null : JSON.stringify(input.details),
    ],
  );
}

export async function recentAudit(db: Database, limit = 100): Promise<AuditRow[]> {
  return (await db.query(
    'SELECT * FROM audit_events ORDER BY at DESC, id DESC LIMIT ?',
    [limit],
  )) as unknown as AuditRow[];
}
