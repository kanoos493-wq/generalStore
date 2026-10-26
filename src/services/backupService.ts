/**
 * Backup / restore.
 *
 * A backup is a consistent SQLite snapshot (VACUUM INTO) written by the native
 * bridge, checksummed and recorded in the `backups` table. Restore validates
 * the candidate file *before* replacing anything and keeps the previous
 * database until the restored copy passes integrity checks.
 */
import type { Database } from '../db/database';
import type { Actor } from '../core/permissions';
import { assertCan } from '../core/permissions';
import { newId } from '../core/ids';
import { nowIso, toDateKey } from '../core/dates';
import { ValidationError, BusinessError } from '../core/errors';
import { audit } from './auditService';
import type { BackupFileInfo, BackupResult } from '../native/bridge';

export interface BackupTarget {
  create(name: string, encrypt: boolean): Promise<BackupResult>;
  list(): Promise<BackupFileInfo[]>;
  delete(path: string): Promise<void>;
  verify(path: string): Promise<{ ok: boolean; integrity: string; schemaVersion: number }>;
  restore(path: string): Promise<void>;
  share(path: string): Promise<void>;
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  path: string;
  sizeBytes: number;
  encrypted: boolean;
  schemaVersion: number;
  checksum: string | null;
  status: string;
}

export async function createBackup(
  db: Database,
  target: BackupTarget,
  input: { encrypt: boolean; actor: Actor; note?: string },
): Promise<BackupRecord> {
  assertCan(input.actor.role, 'backup.manage');
  const stamp = `${toDateKey(new Date())}-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`;
  // Backups taken in the same second must not overwrite each other.
  const id = newId('bak');
  const suffix = id.slice(-6);
  const name = `generalstore-${stamp}-${suffix}${input.encrypt ? '.gsdb.enc' : '.gsdb'}`;
  const result = await target.create(name, input.encrypt);
  const schemaVersion = await db.schemaVersion();
  await db.tx(async tx => {
    await tx.exec(
      `INSERT INTO backups (id, created_at, path, size_bytes, encrypted, schema_version, checksum, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?)`,
      [id, nowIso(), result.path, result.size, input.encrypt ? 1 : 0, schemaVersion, result.checksum, input.note ?? null],
    );
    await audit(tx, {
      actor: input.actor,
      action: 'backup.create',
      entity: 'backup',
      entityId: id,
      details: { path: result.path, size: result.size, encrypted: input.encrypt },
    });
  });
  return {
    id,
    createdAt: nowIso(),
    path: result.path,
    sizeBytes: result.size,
    encrypted: input.encrypt,
    schemaVersion,
    checksum: result.checksum,
    status: 'ok',
  };
}

export async function backupHistory(db: Database): Promise<BackupRecord[]> {
  const rows = await db.query('SELECT * FROM backups ORDER BY created_at DESC LIMIT 25');
  return rows.map(r => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    path: String(r.path),
    sizeBytes: Number(r.size_bytes),
    encrypted: Number(r.encrypted) === 1,
    schemaVersion: Number(r.schema_version),
    checksum: r.checksum === null ? null : String(r.checksum),
    status: String(r.status),
  }));
}

export async function lastBackup(db: Database): Promise<BackupRecord | null> {
  const rows = await backupHistory(db);
  return rows[0] ?? null;
}

export interface RestorePrecheck {
  ok: boolean;
  integrity: string;
  schemaVersion: number;
  message: string;
}

/** Validates a backup file before anything is replaced. */
export async function precheckBackup(
  target: BackupTarget,
  path: string,
  supportedVersion: number,
): Promise<RestorePrecheck> {
  const result = await target.verify(path);
  if (!result.ok) {
    return {
      ok: false,
      integrity: result.integrity,
      schemaVersion: result.schemaVersion,
      message: `Backup failed the integrity check: ${result.integrity}`,
    };
  }
  if (result.schemaVersion > supportedVersion) {
    return {
      ok: false,
      integrity: result.integrity,
      schemaVersion: result.schemaVersion,
      message: 'This backup was created by a newer app version. Update the app first.',
    };
  }
  return {
    ok: true,
    integrity: result.integrity,
    schemaVersion: result.schemaVersion,
    message: 'Backup verified',
  };
}

/**
 * Restores a verified backup. The caller must re-open the database afterwards
 * (the native bridge reopens the file in place).
 */
export async function restoreBackup(
  db: Database,
  target: BackupTarget,
  input: { path: string; actor: Actor; supportedVersion: number },
): Promise<void> {
  assertCan(input.actor.role, 'backup.manage');
  if (!input.path) {throw new ValidationError('Select a backup file first');}
  const check = await precheckBackup(target, input.path, input.supportedVersion);
  if (!check.ok) {throw new BusinessError(check.message, 'backup_invalid');}
  await target.restore(input.path);
  const integrity = await db.integrityCheck();
  if (!integrity.toLowerCase().includes('ok')) {
    throw new BusinessError(
      `Restored database failed the integrity check (${integrity}). The previous database is still on disk.`,
      'restore_failed',
    );
  }
  const version = await db.schemaVersion();
  if (version < input.supportedVersion) {
    // Safe, forward-only migrations are applied on the next open.
  }
  await audit(db, {
    actor: input.actor,
    action: 'backup.restore',
    entity: 'backup',
    entityId: input.path,
    details: { integrity, version },
  });
}

export function formatBytes(size: number): string {
  if (size < 1024) {return `${size} B`;}
  if (size < 1024 * 1024) {return `${(size / 1024).toFixed(1)} KB`;}
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function backupDue(last: BackupRecord | null, reminderDays: number): boolean {
  if (!last) {return true;}
  const age = (Date.now() - new Date(last.createdAt).getTime()) / 86400000;
  return age >= reminderDays;
}
