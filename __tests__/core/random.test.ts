/**
 * Randomness is where the app crashed on a real phone
 * ("crypto.getRandomValues must be defined"): Android has no Web Crypto, so the
 * PIN salt had no source. These tests cover the replacement contract.
 */
import {
  bytesToHex,
  hexToBytes,
  primeRandomSource,
  randomBytesSync,
  resetRandomSource,
  secureRandomAvailable,
  setRandomProvider,
} from '../../src/core/random';
import { createPinRecord, verifyPin } from '../../src/services/pinService';

/** Fast scrypt so the regression test stays quick. */
const fast = { N: 1024, r: 8, p: 1, dkLen: 32 };

interface MutableGlobal {
  crypto?: unknown;
}

function hidePlatformCrypto(): () => void {
  const glob = globalThis as MutableGlobal;
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  resetRandomSource();
  return () => {
    if (saved) {
      Object.defineProperty(globalThis, 'crypto', saved);
    } else {
      delete glob.crypto;
    }
    resetRandomSource();
  };
}

describe('randomBytesSync', () => {
  afterEach(() => {
    resetRandomSource();
  });

  it('returns exactly the requested number of bytes', () => {
    expect(randomBytesSync(16)).toHaveLength(16);
    expect(randomBytesSync(1)).toHaveLength(1);
    expect(randomBytesSync(32)).toHaveLength(32);
  });

  it('never repeats a salt', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      seen.add(bytesToHex(randomBytesSync(16)));
    }
    expect(seen.size).toBe(64);
  });

  it('round-trips bytes through hex', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it('rejects malformed hex from a native source', () => {
    expect(() => hexToBytes('')).toThrow(/malformed/i);
    expect(() => hexToBytes('abc')).toThrow(/malformed/i);
    expect(() => hexToBytes('zz')).toThrow(/malformed/i);
    expect(hexToBytes('00ff')).toEqual(new Uint8Array([0, 255]));
  });

  it('reports a source as available in this runtime', () => {
    expect(secureRandomAvailable()).toBe(true);
  });
});

describe('native entropy pool', () => {
  afterEach(() => {
    resetRandomSource();
  });

  it('fills the pool from the provider and serves salts from it', async () => {
    const restoreCrypto = hidePlatformCrypto();
    let calls = 0;
    setRandomProvider(async bytes => {
      calls += 1;
      return Uint8Array.from({ length: bytes }, (_, i) => (i % 251) + 1);
    });
    try {
      expect(await primeRandomSource()).toBe(true);
      expect(calls).toBe(1);
      expect(secureRandomAvailable()).toBe(true);

      const first = randomBytesSync(16);
      expect(first).toHaveLength(16);
      // Served from the pool, not a second native round trip.
      expect(calls).toBe(1);
      expect(Array.from(first)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    } finally {
      restoreCrypto();
    }
  });

  it('reports failure when the native source is missing', async () => {
    const restoreCrypto = hidePlatformCrypto();
    try {
      setRandomProvider(async () => {
        throw new Error('module unavailable');
      });
      expect(await primeRandomSource()).toBe(false);
      expect(secureRandomAvailable()).toBe(false);
    } finally {
      restoreCrypto();
    }
  });

  it('still salts a PIN when the platform has no Web Crypto (the on-device path)', async () => {
    const restoreCrypto = hidePlatformCrypto();
    try {
      // Android: only the native provider exists. This is the exact case that
      // used to throw "crypto.getRandomValues must be defined".
      let counter = 7;
      setRandomProvider(async bytes => {
        const out = new Uint8Array(bytes);
        for (let i = 0; i < bytes; i += 1) {
          counter = (counter * 1103515245 + 12345) % 2147483647;
          out[i] = counter % 256;
        }
        return out;
      });
      expect(await primeRandomSource()).toBe(true);

      const record = await createPinRecord('4827', undefined, fast);
      expect(record.salt).toHaveLength(32);
      expect(await verifyPin('4827', record)).toBe(true);
      expect(await verifyPin('4828', record)).toBe(false);
      // A second PIN gets a different salt from the pool.
      const second = await createPinRecord('5731', undefined, fast);
      expect(second.salt).not.toBe(record.salt);
    } finally {
      restoreCrypto();
    }
  });

  it('fails loudly on a device rather than using a weak source', () => {
    const restoreCrypto = hidePlatformCrypto();
    const workerId = process.env.JEST_WORKER_ID;
    try {
      // Outside Jest there is no test-only fallback: an insecure salt must be
      // an error the user can see, never a silent downgrade.
      delete process.env.JEST_WORKER_ID;
      expect(() => randomBytesSync(16)).toThrow(/secure random source/i);
    } finally {
      process.env.JEST_WORKER_ID = workerId;
      restoreCrypto();
    }
  });
});
