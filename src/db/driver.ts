/**
 * SQL driver boundary.
 *
 * The app talks to SQLite only through this interface, which has two
 * implementations:
 *   - `NativeSqliteDriver` (Android, via the Kotlin SqliteBridge module)
 *   - `NodeSqliteDriver` (tests / tooling, via node:sqlite)
 *
 * Keeping this narrow boundary is what makes the whole database layer
 * testable in Node without an emulator.
 */

export type SqlParam = string | number | null;

export type SqlRow = Record<string, string | number | null>;

export interface SqlDriver {
  /** Execute one or more statements, ignoring results. */
  exec(sql: string, params?: SqlParam[]): Promise<void>;
  /** Run a query and return rows. */
  query(sql: string, params?: SqlParam[]): Promise<SqlRow[]>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
  /** Absolute path of the database file when the platform exposes it. */
  readonly location: string;
  /** Copy a consistent snapshot of the database to `path`. */
  backupTo(path: string): Promise<void>;
  /** PRAGMA integrity_check result. */
  integrityCheck(): Promise<string>;
}

export interface SqlExecutor {
  exec(sql: string, params?: SqlParam[]): Promise<void>;
  query(sql: string, params?: SqlParam[]): Promise<SqlRow[]>;
}

export class SqliteError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SqliteError';
  }
}
