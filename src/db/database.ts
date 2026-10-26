/**
 * Database handle: serializes statements on one connection and provides
 * transaction-safe execution. All business services receive a `Tx`.
 */
import type { SqlDriver, SqlExecutor, SqlParam, SqlRow } from './driver';
import { SqliteError } from './driver';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './schema';
import { seedDefaults } from './seed';

export class Tx implements SqlExecutor {
  constructor(private readonly driver: SqlDriver, private readonly depth: number = 0) {}

  async exec(sql: string, params: SqlParam[] = []): Promise<void> {
    try {
      await this.driver.exec(sql, params);
    } catch (e) {
      throw new SqliteError(`exec failed: ${(e as Error).message}`, e);
    }
  }

  async query(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    try {
      return await this.driver.query(sql, params);
    } catch (e) {
      throw new SqliteError(`query failed: ${(e as Error).message}`, e);
    }
  }

  async one<T = SqlRow>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const rows = await this.query(sql, params);
    return rows[0] as T | undefined;
  }

  async scalar<T = number>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const row = await this.one<SqlRow>(sql, params);
    if (!row) {return null;}
    const values = Object.values(row);
    return (values[0] as T) ?? null;
  }

  /** Nested transaction via SAVEPOINT (used by composed services). */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const name = `sp_${this.depth + 1}`;
    await this.driver.exec(`SAVEPOINT ${name}`);
    try {
      const result = await fn(new Tx(this.driver, this.depth + 1));
      await this.driver.exec(`RELEASE ${name}`);
      return result;
    } catch (e) {
      await this.driver.exec(`ROLLBACK TO ${name}`);
      await this.driver.exec(`RELEASE ${name}`);
      throw e;
    }
  }
}

export class Database implements SqlExecutor {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly driver: SqlDriver) {}

  get location(): string {
    return this.driver.location;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.queue.then(op, op);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  exec(sql: string, params: SqlParam[] = []): Promise<void> {
    return this.enqueue(async () => {
      try {
        await this.driver.exec(sql, params);
      } catch (e) {
        throw new SqliteError(`exec failed: ${(e as Error).message}`, e);
      }
    });
  }

  query(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    return this.enqueue(async () => {
      try {
        return await this.driver.query(sql, params);
      } catch (e) {
        throw new SqliteError(`query failed: ${(e as Error).message}`, e);
      }
    });
  }

  async one<T = SqlRow>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const rows = await this.query(sql, params);
    return rows[0] as T | undefined;
  }

  async scalar<T = number>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const row = await this.one<SqlRow>(sql, params);
    if (!row) {return null;}
    const values = Object.values(row);
    return (values[0] as T) ?? null;
  }

  /** Run `fn` inside a single write transaction. Never leaves partial writes. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.driver.begin();
      const tx = new Tx(this.driver);
      try {
        const result = await fn(tx);
        await this.driver.commit();
        return result;
      } catch (e) {
        try {
          await this.driver.rollback();
        } catch {
          // connection may already be rolled back by SQLite
        }
        throw e;
      }
    });
  }

  async schemaVersion(): Promise<number> {
    const v = await this.scalar<number>('PRAGMA user_version');
    return Number(v ?? 0);
  }

  /** Applies pending migrations, each in its own transaction. */
  async migrate(): Promise<{ from: number; to: number }> {
    const from = await this.schemaVersion();
    for (const migration of MIGRATIONS) {
      if (migration.version <= from) {continue;}
      await this.tx(async tx => {
        for (const statement of migration.statements) {
          await tx.exec(statement);
        }
        // user_version cannot be parameterized; version comes from code constants.
        await tx.exec(`PRAGMA user_version = ${Math.floor(migration.version)}`);
      });
    }
    return { from, to: MIGRATIONS.length ? LATEST_SCHEMA_VERSION : from };
  }

  async seed(): Promise<void> {
    await this.tx(async tx => seedDefaults(tx));
  }

  async integrityCheck(): Promise<string> {
    return this.driver.integrityCheck();
  }

  async backupTo(path: string): Promise<void> {
    await this.enqueue(() => this.driver.backupTo(path));
  }

  async close(): Promise<void> {
    await this.enqueue(() => this.driver.close());
  }
}

const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
  'PRAGMA temp_store = MEMORY',
  'PRAGMA cache_size = -8000',
];

/** Opens, configures, migrates and seeds a database handle. */
export async function openDatabase(driver: SqlDriver): Promise<Database> {
  const db = new Database(driver);
  for (const pragma of PRAGMAS) {
    await db.exec(pragma);
  }
  await db.migrate();
  await db.seed();
  return db;
}
