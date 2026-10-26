/** Application store: database handle, settings, language, operator, lock state. */
import { AppState, I18nManager, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { Database, openDatabase } from '../../db/database';
import { loadSettings, setSettings, type Language, type StoreSettings } from '../../services/settingsService';
import { NativeSecureStorage, NativeSqliteDriver } from '../../native/bridge';
import { PinManager, autoLockMs } from '../../services/pinService';
import type { Actor, Role } from '../../core/permissions';
import { messageOf } from '../../core/errors';

export const secureStorage = new NativeSecureStorage();
export const pinManager = new PinManager(secureStorage);

interface AppStateShape {
  ready: boolean;
  bootError: string | null;
  db: Database | null;
  settings: StoreSettings | null;
  language: Language;
  actor: Actor;
  needsSetup: boolean;
  locked: boolean;
  lastActivity: number;
  initialize: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setRole: (role: Role) => Promise<void>;
  saveSettings: (values: Record<string, string>) => Promise<void>;
  lock: () => void;
  unlock: () => void;
  completeSetup: () => Promise<void>;
  noteActivity: () => void;
  shouldAutoLock: () => boolean;
  handleAppState: (status: AppStateStatus) => void;
}

function actorForRole(role: Role): Actor {
  return { id: `operator_${role}`, name: role === 'owner' ? 'Owner' : role.charAt(0).toUpperCase() + role.slice(1), role };
}

export const useAppStore = create<AppStateShape>()((set, get) => ({
  ready: false,
  bootError: null,
  db: null,
  settings: null,
  language: 'en',
  actor: actorForRole('owner'),
  needsSetup: false,
  locked: true,
  lastActivity: Date.now(),

  initialize: async () => {
    try {
      const driver = new NativeSqliteDriver();
      if (driver instanceof NativeSqliteDriver) {
        await driver.open();
      }
      const db = await openDatabase(driver);
      const settings = await loadSettings(db);
      const hasPin = await pinManager.hasPin();
      const roleRow = await db.scalar<string>(`SELECT value FROM settings WHERE key = 'operator_role'`);
      const role = (roleRow as Role) || 'owner';
      set({
        db,
        settings,
        language: settings.language,
        actor: actorForRole(role),
        ready: true,
        bootError: null,
        needsSetup: settings.pinEnabled && !hasPin,
        locked: true,
        lastActivity: Date.now(),
      });
    } catch (error) {
      set({ ready: false, bootError: messageOf(error) });
    }
  },

  refreshSettings: async () => {
    const db = get().db;
    if (!db) {return;}
    const settings = await loadSettings(db);
    set({ settings, language: settings.language });
  },

  setLanguage: async (language) => {
    const db = get().db;
    if (!db) {return;}
    await db.tx(tx => setSettings(tx, { language }));
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(language === 'ur');
    await get().refreshSettings();
  },

  setRole: async (role) => {
    const db = get().db;
    if (!db) {return;}
    await db.tx(tx => setSettings(tx, { operator_role: role }));
    set({ actor: actorForRole(role) });
  },

  saveSettings: async (values) => {
    const db = get().db;
    if (!db) {return;}
    await db.tx(tx => setSettings(tx, values));
    await get().refreshSettings();
  },

  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false, lastActivity: Date.now() }),
  completeSetup: async () => {
    set({ needsSetup: false, locked: false, lastActivity: Date.now() });
  },
  noteActivity: () => set({ lastActivity: Date.now() }),

  shouldAutoLock: () => {
    const { settings, locked, lastActivity } = get();
    const timeout = autoLockMs(settings?.autoLockTimeout ?? '1min');
    if (locked || timeout === 0) {return false;}
    return Date.now() - lastActivity > timeout;
  },

  handleAppState: (status) => {
    const { settings, locked, lastActivity } = get();
    if (status === 'active') {
      const timeout = autoLockMs(settings?.autoLockTimeout ?? '1min');
      if (!locked && timeout > 0 && Date.now() - lastActivity > timeout) {
        set({ locked: true });
      }
      set({ lastActivity: Date.now() });
    } else if (status === 'background') {
      set({ lastActivity: Date.now() });
    }
  },
}));

/** Subscribe once (called from App) for background/foreground lock behaviour. */
export function attachAppStateListener(): () => void {
  const handler = (status: AppStateStatus) => useAppStore.getState().handleAppState(status);
  const sub = AppState.addEventListener('change', handler);
  return () => sub.remove();
}

export function useDb(): Database {
  const db = useAppStore(s => s.db);
  if (!db) {throw new Error('Database is not ready');}
  return db;
}

export function useActor(): Actor {
  return useAppStore(s => s.actor);
}

export function useSettings(): StoreSettings {
  const settings = useAppStore(s => s.settings);
  if (!settings) {throw new Error('Settings are not ready');}
  return settings;
}
