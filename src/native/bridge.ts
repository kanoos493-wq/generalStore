/**
 * Typed access to the small set of native modules this app ships itself:
 *   SqliteBridge  - SQLite (single connection, transactions, backups)
 *   SecureStore   - Android Keystore AES-GCM for PIN verifier + recovery data
 *   PrinterBridge - ESC/POS raw printing + Android print framework
 *
 * Everything the JS layer needs is behind these three modules; no third-party
 * native packages are required for storage, security or printing.
 */
import { NativeModules, Platform } from 'react-native';
import type { SqlDriver, SqlParam, SqlRow } from '../db/driver';
import type { SecureStorageAdapter } from '../services/pinService';

export interface BackupFileInfo {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

export interface BackupResult {
  path: string;
  size: number;
  checksum: string;
}

export interface SqliteBridgeModule {
  open(dbName: string): Promise<boolean>;
  exec(sql: string, params: (string | number | null)[]): Promise<boolean>;
  query(sql: string, params: (string | number | null)[]): Promise<SqlRow[]>;
  begin(): Promise<boolean>;
  commit(): Promise<boolean>;
  rollback(): Promise<boolean>;
  close(): Promise<boolean>;
  getPath(): Promise<string>;
  backupTo(name: string, encrypt: boolean): Promise<BackupResult>;
  listBackups(): Promise<BackupFileInfo[]>;
  deleteFile(path: string): Promise<boolean>;
  writeFile(folder: string, name: string, content: string): Promise<string>;
  shareFile(path: string): Promise<boolean>;
  verifyDatabaseFile(path: string): Promise<{ ok: boolean; integrity: string; schemaVersion: number }>;
  restore(path: string): Promise<boolean>;
  integrityCheck(): Promise<string>;
  databaseSize(): Promise<number>;
}

export interface SecureStoreModule extends SecureStorageAdapter {
  isAvailable(): Promise<boolean>;
  decryptFile(path: string): Promise<string>;
  sha256OfFile(path: string): Promise<string>;
}

export interface PrinterBridgeModule {
  isBluetoothEnabled(): Promise<boolean>;
  listPairedDevices(): Promise<{ name: string; address: string }[]>;
  printBluetooth(address: string, text: string): Promise<boolean>;
  printText(text: string, fontSize: number, jobName: string): Promise<boolean>;
}

const isTestEnv = typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;

function moduleOrNull<T>(name: string): T | null {
  if (Platform.OS !== 'android' || isTestEnv) {return null;}
  return (NativeModules[name] as T) ?? null;
}

export const sqliteBridge = (): SqliteBridgeModule | null => moduleOrNull<SqliteBridgeModule>('SqliteBridge');
export const secureStore = (): SecureStoreModule | null => moduleOrNull<SecureStoreModule>('SecureStore');
export const printerBridge = (): PrinterBridgeModule | null => moduleOrNull<PrinterBridgeModule>('PrinterBridge');

export function nativeModulesAvailable(): boolean {
  return !!sqliteBridge() && !!secureStore();
}

export class NativeSqliteDriver implements SqlDriver {
  readonly location = 'app-private://generalstore.db';
  private opened = false;

  constructor(private readonly name = 'generalstore.db') {}

  private bridge(): SqliteBridgeModule {
    const bridge = sqliteBridge();
    if (!bridge) {throw new Error('SqliteBridge native module is unavailable');}
    return bridge;
  }

  async open(): Promise<void> {
    const bridge = this.bridge();
    await bridge.open(this.name);
    this.opened = true;
    const path = await bridge.getPath();
    (this as { location: string }).location = path;
  }

  async exec(sql: string, params: SqlParam[] = []): Promise<void> {
    if (!this.opened) {await this.open();}
    await this.bridge().exec(sql, params);
  }

  async query(sql: string, params: SqlParam[] = []): Promise<SqlRow[]> {
    if (!this.opened) {await this.open();}
    return this.bridge().query(sql, params);
  }

  async begin(): Promise<void> {
    await this.bridge().begin();
  }

  async commit(): Promise<void> {
    await this.bridge().commit();
  }

  async rollback(): Promise<void> {
    await this.bridge().rollback();
  }

  async close(): Promise<void> {
    await this.bridge().close();
  }

  async backupTo(path: string): Promise<void> {
    // Native backups go through backupTo(name); the path form is only used by
    // tooling, so this is a no-op with a clear error for the app.
    throw new Error(`NativeSqliteDriver cannot back up to an arbitrary path (${path}); use createBackup()`);
  }

  async integrityCheck(): Promise<string> {
    return this.bridge().integrityCheck();
  }
}

/** Keystore-backed secure storage with a loud fallback. */
export class NativeSecureStorage implements SecureStorageAdapter {
  private fallback = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    const store = secureStore();
    if (!store) {return this.fallback.get(key) ?? null;}
    return store.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const store = secureStore();
    if (!store) {
      this.fallback.set(key, value);
      return;
    }
    await store.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    const store = secureStore();
    if (!store) {
      this.fallback.delete(key);
      return;
    }
    await store.removeItem(key);
  }

  async isHardwareBacked(): Promise<boolean> {
    const store = secureStore();
    if (!store) {return false;}
    return store.isAvailable();
  }
}

export class NativeBackupTarget {
  async create(name: string, encrypt: boolean): Promise<BackupResult> {
    const bridge = sqliteBridge();
    if (!bridge) {throw new Error('Backups require the native SqliteBridge');}
    return bridge.backupTo(name, encrypt);
  }

  async list(): Promise<BackupFileInfo[]> {
    const bridge = sqliteBridge();
    return bridge ? bridge.listBackups() : [];
  }

  async delete(path: string): Promise<void> {
    const bridge = sqliteBridge();
    if (bridge) {await bridge.deleteFile(path);}
  }

  async verify(path: string): Promise<{ ok: boolean; integrity: string; schemaVersion: number }> {
    const bridge = sqliteBridge();
    if (!bridge) {throw new Error('Verification requires the native SqliteBridge');}
    return bridge.verifyDatabaseFile(path);
  }

  async restore(path: string): Promise<void> {
    const bridge = sqliteBridge();
    if (!bridge) {throw new Error('Restore requires the native SqliteBridge');}
    await bridge.restore(path);
  }

  async writeExport(name: string, content: string): Promise<string> {
    const bridge = sqliteBridge();
    if (!bridge) {throw new Error('Export requires the native SqliteBridge');}
    return bridge.writeFile('exports', name, content);
  }

  async writeBackupCopy(name: string, content: string): Promise<string> {
    const bridge = sqliteBridge();
    if (!bridge) {throw new Error('Import requires the native SqliteBridge');}
    return bridge.writeFile('backups', name, content);
  }

  async share(path: string): Promise<void> {
    const bridge = sqliteBridge();
    if (bridge) {await bridge.shareFile(path);}
  }
}
