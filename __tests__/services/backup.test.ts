import * as fs from 'node:fs';
import * as path from 'node:path';
import { Database, openDatabase } from '../../src/db/database';
import { NodeSqliteDriver } from '../../src/db/nodeDriver';
import { LATEST_SCHEMA_VERSION } from '../../src/db/schema';
import {
  backupDue,
  backupHistory,
  createBackup,
  precheckBackup,
  restoreBackup,
  type BackupTarget,
} from '../../src/services/backupService';
import { createProduct } from '../../src/services/productService';
import { makeDb, cleanup, owner, cashier, tempDbPath } from '../support/testDb';

/**
 * Node implementation of the native backup target. The Android version copies
 * the snapshot with the native bridge (and applies Keystore encryption when
 * requested); here we use SQLite's own VACUUM INTO for a consistent snapshot.
 */
class NodeBackupTarget implements BackupTarget {
  constructor(private dir: string, private db: Database, private dbPath: string) {}

  async create(name: string) {
    const target = path.join(this.dir, name);
    await this.db.backupTo(target);
    const size = fs.statSync(target).size;
    return { path: target, size, checksum: `size-${size}` };
  }

  async list() {
    return fs
      .readdirSync(this.dir)
      .filter(f => f.endsWith('.gsdb'))
      .map(name => {
        const full = path.join(this.dir, name);
        const stat = fs.statSync(full);
        return { name, path: full, size: stat.size, mtime: stat.mtimeMs };
      });
  }

  async delete(target: string) {
    fs.rmSync(target, { force: true });
  }

  async verify(target: string) {
    const driver = new NodeSqliteDriver(target);
    try {
      const integrity = await driver.integrityCheck();
      const rows = await driver.query('PRAGMA user_version');
      return {
        ok: integrity.toLowerCase().includes('ok'),
        integrity,
        schemaVersion: Number(rows[0]?.user_version ?? 0),
      };
    } finally {
      await driver.close();
    }
  }

  async restore(target: string) {
    // The real device closes the database, replaces the file, then reopens.
    fs.copyFileSync(target, this.dbPath);
  }

  async share() {
    // nothing to share in a Node test
  }
}

let dir: string;
let db: Database;
let dbPath: string;
let target: NodeBackupTarget;

beforeAll(async () => {
  const made = await makeDb();
  db = made.db;
  dbPath = made.path;
  dir = path.dirname(made.path);
  target = new NodeBackupTarget(dir, db, dbPath);
  await createProduct(db, { nameEn: 'Backup Test Product', baseUnit: 'kg', salePricePaisa: 10000, actor: owner });
});

afterAll(async () => {
  try {
    await db.close();
  } catch {
    // already closed by the restore test
  }
  cleanup();
});

describe('backup and restore', () => {
  it('creates a verifiable snapshot and records it', async () => {
    const record = await createBackup(db, target, { encrypt: false, actor: owner });
    expect(fs.existsSync(record.path)).toBe(true);
    expect(record.sizeBytes).toBeGreaterThan(0);
    expect(record.schemaVersion).toBe(LATEST_SCHEMA_VERSION);

    const history = await backupHistory(db);
    expect(history[0].id).toBe(record.id);
    expect(history[0].encrypted).toBe(false);

    const check = await precheckBackup(target, record.path, LATEST_SCHEMA_VERSION);
    expect(check.ok).toBe(true);
    expect(check.integrity.toLowerCase()).toContain('ok');
  });

  it('rejects a corrupt backup file', async () => {
    const corrupt = path.join(dir, 'broken.gsdb');
    fs.writeFileSync(corrupt, 'this is not a database');
    await expect(precheckBackup(target, corrupt, LATEST_SCHEMA_VERSION)).rejects.toThrow();
  });

  it('refuses a backup created by a newer app version', async () => {
    const futurePath = tempDbPath('future');
    const future = new NodeSqliteDriver(futurePath);
    await future.exec('PRAGMA user_version = 99');
    await future.close();
    const check = await precheckBackup(target, futurePath, LATEST_SCHEMA_VERSION);
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/newer app version/i);
  });

  it('denies restore to a cashier', async () => {
    const record = await createBackup(db, target, { encrypt: false, actor: owner });
    await expect(
      restoreBackup(db, target, { path: record.path, actor: cashier, supportedVersion: LATEST_SCHEMA_VERSION }),
    ).rejects.toThrow(/Permission denied/i);
  });

  it('restores a snapshot and keeps the data intact', async () => {
    const record = await createBackup(db, target, { encrypt: false, actor: owner });
    await createProduct(db, { nameEn: 'Written After Backup', baseUnit: 'kg', salePricePaisa: 5000, actor: owner });

    // Simulate the native restore: close, replace the file, reopen.
    await db.close();
    await target.restore(record.path);
    db = await openDatabase(new NodeSqliteDriver(dbPath));

    expect((await db.integrityCheck()).toLowerCase()).toContain('ok');
    expect(await db.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);

    const lost = await db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM products WHERE name_en = 'Written After Backup'`);
    expect(Number(lost!.c)).toBe(0);
    const kept = await db.one<{ c: number }>(`SELECT COUNT(*) AS c FROM products WHERE name_en = 'Backup Test Product'`);
    expect(Number(kept!.c)).toBe(1);
  });

  it('reminds when a backup is due', () => {
    const base = {
      id: 'b',
      path: '/x',
      sizeBytes: 1,
      encrypted: false,
      schemaVersion: 1,
      checksum: null,
      status: 'ok',
    };
    expect(backupDue(null, 7)).toBe(true);
    expect(backupDue({ ...base, createdAt: new Date().toISOString() }, 7)).toBe(false);
    expect(backupDue({ ...base, createdAt: new Date(Date.now() - 30 * 86400000).toISOString() }, 7)).toBe(true);
  });
});
