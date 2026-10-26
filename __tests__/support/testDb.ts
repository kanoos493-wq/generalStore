/** Test helpers: real SQLite databases in a temp directory (node:sqlite). */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Database, openDatabase } from '../../src/db/database';
import { NodeSqliteDriver } from '../../src/db/nodeDriver';
import type { Actor } from '../../src/core/permissions';
import { OWNER } from '../../src/core/permissions';

export const tempDirs: string[] = [];

export function tempDbPath(name = 'test'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-test-'));
  tempDirs.push(dir);
  return path.join(dir, `${name}.db`);
}

export async function makeDb(): Promise<{ db: Database; path: string }> {
  const dbPath = tempDbPath();
  const driver = new NodeSqliteDriver(dbPath);
  const db = await openDatabase(driver);
  return { db, path: dbPath };
}

export function cleanup(): void {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

export const owner: Actor = OWNER;
export const cashier: Actor = { id: 'u2', name: 'Bilal', role: 'cashier' };
export const inventory: Actor = { id: 'u3', name: 'Nadia', role: 'inventory' };
export const accountant: Actor = { id: 'u4', name: 'Sara', role: 'accountant' };

export const manager: Actor = { id: 'u5', name: 'Zaid', role: 'manager' };
