/**
 * node:sqlite driver — used by Jest integration tests and CLI tooling.
 * Never imported by the React Native app.
 */
import type { SqlDriver, SqlParam, SqlRow } from './driver';

interface NodeStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}

interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeDatabase;
}

declare const require: (moduleName: string) => unknown;
const nodeSqlite = require('node:sqlite') as NodeSqliteModule;

export class NodeSqliteDriver implements SqlDriver {
  private db: NodeDatabase;

  constructor(readonly location: string) {
    this.db = new nodeSqlite.DatabaseSync(location);
  }

  async exec(sql: string, params: SqlParam[] = []): Promise<void> {
    if (params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.prepare(sql).run(...params);
  }

  async query(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    const rows = this.db.prepare(sql).all(...params) as SqlRow[];
    return rows.map(r => {
      const out: SqlRow = {};
      for (const key of Object.keys(r)) {
        const v = (r as Record<string, unknown>)[key];
        out[key] = typeof v === 'bigint' ? Number(v) : (v as string | number | null);
      }
      return out;
    });
  }

  async begin(): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE');
  }

  async commit(): Promise<void> {
    this.db.exec('COMMIT');
  }

  async rollback(): Promise<void> {
    this.db.exec('ROLLBACK');
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async backupTo(path: string): Promise<void> {
    const escaped = path.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }

  async integrityCheck(): Promise<string> {
    const rows = this.db.prepare('PRAGMA integrity_check').all() as { integrity_check?: string }[];
    return rows.map(r => String(r.integrity_check ?? '')).join('\n') || 'unknown';
  }
}
