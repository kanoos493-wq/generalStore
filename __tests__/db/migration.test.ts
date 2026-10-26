import * as fs from 'node:fs';
import { Database, openDatabase } from '../../src/db/database';
import { NodeSqliteDriver } from '../../src/db/nodeDriver';
import { LATEST_SCHEMA_VERSION } from '../../src/db/schema';
import { tempDbPath, makeDb, cleanup } from '../support/testDb';

afterAll(cleanup);

describe('schema migrations', () => {
  it('creates a fresh database at the latest schema version', async () => {
    const { db } = await makeDb();
    expect(await db.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
  });

  it('is idempotent when opened twice', async () => {
    const path = tempDbPath('reopen');
    const first = await openDatabase(new NodeSqliteDriver(path));
    await first.close();
    const second = await openDatabase(new NodeSqliteDriver(path));
    expect(await second.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
    const units = await second.scalar<number>('SELECT COUNT(*) FROM units');
    expect(units).toBeGreaterThan(15);
  });

  it('seeds units, payment methods, categories and settings exactly once', async () => {
    const { db } = await makeDb();
    await db.seed();
    const methods = await db.query('SELECT * FROM payment_methods ORDER BY sort');
    expect(methods.map(m => m.code)).toEqual(['cash', 'bank', 'card', 'wallet', 'raast', 'credit']);
    const cash = methods[0];
    expect(Number(cash.is_cash)).toBe(1);
    const settings = await db.scalar<string>(`SELECT value FROM settings WHERE key = 'currency'`);
    expect(settings).toBe('PKR');
  });

  it('passes the SQLite integrity check', async () => {
    const { db } = await makeDb();
    expect((await db.integrityCheck()).toLowerCase()).toContain('ok');
  });

  it('creates a consistent backup that can be reopened', async () => {
    const { db, path } = await makeDb();
    const backupPath = `${path}.backup`;
    await db.backupTo(backupPath);
    expect(fs.existsSync(backupPath)).toBe(true);
    const restored = await openDatabase(new NodeSqliteDriver(backupPath));
    expect(await restored.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
    expect((await restored.integrityCheck()).toLowerCase()).toContain('ok');
    await restored.close();
    await db.close();
    const reopened = new Database(new NodeSqliteDriver(path));
    expect(await reopened.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
  });

  it('rolls back a failed migration transaction completely', async () => {
    const { db } = await makeDb();
    await expect(
      db.tx(async tx => {
        await tx.exec(`INSERT INTO settings (key, value) VALUES ('tx_probe', '1')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const probe = await db.scalar(`SELECT value FROM settings WHERE key = 'tx_probe'`);
    expect(probe).toBeNull();
  });
});
