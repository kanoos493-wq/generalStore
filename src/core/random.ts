/**
 * Cryptographically strong randomness for the JS layer.
 *
 * React Native on Android has no Web Crypto: `globalThis.crypto` is undefined.
 * `@noble/hashes`' default `randomBytes()` reads that global, so calling it on
 * a device throws "crypto.getRandomValues must be defined" (this is exactly
 * what happened when a PIN was created on a fresh install). Everything in the
 * app that needs random bytes now goes through this module:
 *
 *   1. `globalThis.crypto.getRandomValues` when the platform provides it
 *      (Jest/Node today, and any future React Native with Web Crypto).
 *   2. An entropy pool filled through a `RandomProvider` that the app layer
 *      installs at start-up - on Android that provider calls the SecureStore
 *      native module, which reads the platform `SecureRandom`.
 *
 * This file stays free of React Native imports so the business logic and its
 * tests run in plain Node; the app wires the provider in appStore.initialize.
 *
 * There is deliberately no `Math.random` fallback on a device: a predictable
 * salt is a silent security downgrade, so the app raises a clear error and the
 * UI tells the user what happened instead. Under Jest only, a local source is
 * used so tests never depend on the host platform.
 */

/** Supplies `bytes` cryptographically strong random bytes (implemented natively). */
export type RandomProvider = (bytes: number) => Promise<Uint8Array>;

let provider: RandomProvider | null = null;

/** Installed once by the app layer before `primeRandomSource()` is called. */
export function setRandomProvider(fn: RandomProvider | null): void {
  provider = fn;
  pool = new Uint8Array(0);
}

/** Minimal shape of the platform random API (avoids depending on lib.dom). */
interface PlatformRandom {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

const POOL_FETCH = 512;
const POOL_LOW_WATER = 128;

let pool = new Uint8Array(0);
let refill: Promise<boolean> | null = null;
let priming: Promise<boolean> | null = null;
let cachedPlatform: PlatformRandom | null = null;
let platformChecked = false;

function platformRandom(): PlatformRandom | null {
  if (!platformChecked) {
    platformChecked = true;
    const candidate = (globalThis as { crypto?: Partial<PlatformRandom> }).crypto;
    cachedPlatform = candidate && typeof candidate.getRandomValues === 'function' ? (candidate as PlatformRandom) : null;
  }
  return cachedPlatform;
}

function isTestRuntime(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return !!env?.JEST_WORKER_ID;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error('Random source returned malformed hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Pulls a fresh batch of bytes from the native random source into the pool. */
function refillFromNative(): Promise<boolean> {
  if (refill) {
    return refill;
  }
  refill = (async () => {
    let ok = false;
    try {
      if (provider) {
        const bytes = await provider(POOL_FETCH);
        const merged = new Uint8Array(pool.length + bytes.length);
        merged.set(pool, 0);
        merged.set(bytes, pool.length);
        pool = merged;
        ok = bytes.length > 0;
      }
    } catch {
      // A failed refill is not fatal while the pool still holds bytes; the
      // next call tries again and reports the problem if it runs dry.
      ok = false;
    } finally {
      refill = null;
    }
    return ok;
  })();
  return refill;
}

/**
 * Fills the entropy pool. Called once from app start; safe to call again.
 * Returns true when some strong source is ready.
 */
export async function primeRandomSource(): Promise<boolean> {
  if (platformRandom()) {
    return true;
  }
  if (pool.length >= POOL_LOW_WATER) {
    return true;
  }
  if (priming) {
    return priming;
  }
  priming = refillFromNative().then(ok => {
    priming = null;
    return ok || pool.length > 0;
  });
  return priming;
}

/** True when `randomBytesSync` can currently produce strong bytes. */
export function secureRandomAvailable(): boolean {
  return !!platformRandom() || pool.length > 0;
}

/**
 * Synchronous strong random bytes - the API `pinService` needs to build salts
 * inside otherwise pure functions.
 */
export function randomBytesSync(length: number): Uint8Array {
  const size = Math.max(1, Math.floor(length));
  const platform = platformRandom();
  if (platform) {
    const out = new Uint8Array(size);
    platform.getRandomValues(out);
    return out;
  }
  if (pool.length >= size) {
    const out = pool.slice(0, size);
    pool = pool.slice(size);
    if (pool.length < POOL_LOW_WATER) {
      void refillFromNative();
    }
    return out;
  }
  if (isTestRuntime()) {
    return testOnlyRandom(size);
  }
  throw new Error(
    'This phone did not provide a secure random source, so a new PIN cannot be created safely. ' +
      'Restart the app and try again; nothing was saved.',
  );
}

export function randomHexSync(length: number): string {
  return bytesToHex(randomBytesSync(length));
}

/** Jest-only source so component tests do not depend on the host platform. */
function testOnlyRandom(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Test helper: forget the primed pool so each test starts from a clean state. */
export function resetRandomSource(): void {
  pool = new Uint8Array(0);
  refill = null;
  priming = null;
  cachedPlatform = null;
  platformChecked = false;
  provider = null;
}
