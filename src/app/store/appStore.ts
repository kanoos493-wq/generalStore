/** Application store: database handle, settings, language, operator, lock state. */
import { AppState, I18nManager, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { Database, openDatabase } from '../../db/database';
import { loadSettings, setSettings, type Language, type StoreSettings } from '../../services/settingsService';
import { NativeSecureStorage, NativeSqliteDriver, secureStore } from '../../native/bridge';
import { PinManager, autoLockMs, type RecoveryAnswerInput } from '../../services/pinService';
import { hexToBytes, primeRandomSource, setRandomProvider } from '../../core/random';
import type { Actor, Role } from '../../core/permissions';
import { messageOf } from '../../core/errors';

export const secureStorage = new NativeSecureStorage();
export const pinManager = new PinManager(secureStorage);

/** Everything the first-run wizard collects, written in one go. */
export interface OnboardingInput {
  storeName: string;
  storeNameUr?: string;
  phone?: string;
  address?: string;
  language: Language;
  operatorName?: string;
  pin?: string | null;
  recovery?: RecoveryAnswerInput[] | null;
}

interface AppStateShape {
  ready: boolean;
  bootError: string | null;
  db: Database | null;
  settings: StoreSettings | null;
  language: Language;
  actor: Actor;
  /** True until the first-run wizard has been completed once. */
  needsSetup: boolean;
  /** Whether a PIN verifier exists in secure storage. */
  hasPin: boolean;
  /** Whether the platform random source was available at start (PIN safety). */
  randomSourceReady: boolean;
  locked: boolean;
  lastActivity: number;
  initialize: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setRole: (role: Role) => Promise<void>;
  saveSettings: (values: Record<string, string>) => Promise<void>;
  finishOnboarding: (input: OnboardingInput) => Promise<void>;
  refreshSecurityState: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
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
  hasPin: false,
  randomSourceReady: false,
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

      // Android's SecureRandom, through the native module, is the only strong
      // random source on a device - React Native has no Web Crypto. Registering
      // it here (before any PIN code can run) is what makes PIN salts possible.
      setRandomProvider(async bytes => {
        const store = secureStore();
        if (!store || typeof store.randomHex !== 'function') {
          throw new Error('The SecureStore native module is unavailable');
        }
        return hexToBytes(await store.randomHex(bytes));
      });
      const randomSourceReady = await primeRandomSource();

      let hasPin: boolean;
      try {
        hasPin = await pinManager.hasPin();
      } catch (error) {
        // Never guess: an unreadable secure store could hide an existing PIN.
        set({
          ready: false,
          bootError: `Secure storage could not be read, so the app cannot tell whether it is protected. ${messageOf(error)}`,
        });
        return;
      }

      const roleRow = await db.scalar<string>(`SELECT value FROM settings WHERE key = 'operator_role'`);
      const role = (roleRow as Role) || 'owner';
      const setupComplete = settings.setupCompleted;

      set({
        db,
        settings,
        language: settings.language,
        actor: actorForRole(role),
        hasPin,
        randomSourceReady,
        ready: true,
        bootError: null,
        // A fresh install (or an install that never finished the wizard) goes
        // straight to setup - never to a PIN prompt the user cannot satisfy.
        needsSetup: !setupComplete,
        locked: setupComplete && hasPin,
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
    set({ language });
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

  /**
   * Completes the first-run wizard: stores the shop profile, optionally
   * creates the PIN with its recovery questions, then opens the app.
   *
   * The PIN is written first: if that fails (policy or random source) nothing
   * else is marked as set up, so the user simply sees the wizard again.
   */
  finishOnboarding: async (input) => {
    const db = get().db;
    if (!db) {throw new Error('The database is not ready yet');}
    const storeName = input.storeName.trim();
    if (!storeName) {throw new Error('Enter the store name to continue');}

    if (input.pin) {
      await pinManager.setPin(
        input.pin,
        input.recovery && input.recovery.length ? { questions: input.recovery } : undefined,
      );
    }

    await db.tx(tx =>
      setSettings(tx, {
        store_name: storeName,
        store_name_ur: (input.storeNameUr ?? '').trim(),
        store_phone: (input.phone ?? '').trim(),
        store_address: (input.address ?? '').trim(),
        operator_name: (input.operatorName ?? '').trim() || 'Owner',
        language: input.language,
        pin_enabled: input.pin ? '1' : '0',
        pin_recovery_enabled: input.recovery && input.recovery.length ? '1' : '0',
        setup_completed: '1',
      }),
    );

    I18nManager.allowRTL(true);
    I18nManager.forceRTL(input.language === 'ur');
    await get().refreshSettings();
    set({
      hasPin: !!input.pin,
      needsSetup: false,
      locked: false,
      lastActivity: Date.now(),
    });
  },

  /** Re-reads the PIN state after the Security screen changes it. */
  refreshSecurityState: async () => {
    const hasPin = await pinManager.hasPin();
    set({ hasPin, locked: hasPin ? get().locked : false, lastActivity: Date.now() });
  },

  lock: () => {
    if (get().hasPin && !get().needsSetup) {
      set({ locked: true });
    }
  },
  unlock: () => set({ locked: false, lastActivity: Date.now() }),
  noteActivity: () => set({ lastActivity: Date.now() }),

  shouldAutoLock: () => {
    const { settings, locked, hasPin, needsSetup, lastActivity } = get();
    if (locked || needsSetup || !hasPin) {return false;}
    const timeout = autoLockMs(settings?.autoLockTimeout ?? '1min');
    if (timeout === 0) {return false;}
    return Date.now() - lastActivity > timeout;
  },

  handleAppState: (status) => {
    const { settings, locked, hasPin, lastActivity } = get();
    if (!hasPin) {
      set({ lastActivity: Date.now() });
      return;
    }
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
