/**
 * PIN security.
 *
 * The PIN is never stored. We store a scrypt verifier (salt + derived key) in
 * Android Keystore backed secure storage. Recovery answers are stored the same
 * way (normalised, salted, hashed) and are never echoed back to the UI.
 */
import { scryptAsync } from '@noble/hashes/scrypt';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { randomBytesSync } from '../core/random';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const PIN_RECORD_VERSION = 1;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  dkLen: number;
}

/** 32 MiB, ~0.1-0.3 s on a mid-range phone. Documented in SECURITY.md. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 32768, r: 8, p: 1, dkLen: 32 };

export interface PinRecord {
  v: number;
  algo: 'scrypt';
  salt: string;
  hash: string;
  params: ScryptParams;
  pinLength: number;
  createdAt: string;
  recovery?: RecoveryRecord;
}

export interface RecoveryQuestionRecord {
  id: string;
  question: string;
  salt: string;
  hash: string;
}

export interface RecoveryRecord {
  v: number;
  algo: 'scrypt';
  params: ScryptParams;
  questions: RecoveryQuestionRecord[];
}

export interface RecoveryAnswerInput {
  id: string;
  question: string;
  answer: string;
}

export class PinPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinPolicyError';
  }
}

export function validatePinFormat(pin: string): void {
  if (!/^\d+$/.test(pin)) {throw new PinPolicyError('PIN must contain digits only');}
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new PinPolicyError(`PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
  }
  if (/^(\d)\1+$/.test(pin) || ['1234', '12345', '123456', '0000', '1111'].includes(pin)) {
    throw new PinPolicyError('Choose a less predictable PIN');
  }
}

/**
 * Runs scrypt asynchronously so the JS thread (and the whole UI) stays
 * responsive on budget phones instead of freezing for the duration of the
 * derivation. Same parameters, same result — only the scheduling differs.
 */
async function derive(secret: string, salt: string, params: ScryptParams): Promise<string> {
  return bytesToHex(await scryptAsync(utf8ToBytes(secret), utf8ToBytes(salt), params));
}

export async function createPinRecord(
  pin: string,
  recovery?: { questions: RecoveryAnswerInput[] },
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<PinRecord> {
  validatePinFormat(pin);
  const salt = bytesToHex(randomBytesSync(16));
  const record: PinRecord = {
    v: PIN_RECORD_VERSION,
    algo: 'scrypt',
    salt,
    hash: await derive(pin, salt, params),
    params,
    pinLength: pin.length,
    createdAt: new Date().toISOString(),
  };
  if (recovery && recovery.questions.length) {
    record.recovery = await createRecoveryRecord(recovery.questions, params);
  }
  return record;
}

export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  if (!record || !record.salt || !record.hash) {return false;}
  const candidate = await derive(pin, record.salt, record.params ?? DEFAULT_SCRYPT);
  return constantTimeEqual(candidate, record.hash);
}

/** Normalisation must be identical at enrolment and verification. */
export function normalizeAnswer(answer: string): string {
  return answer
    .trim()
    .toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
    .replace(/[\u0649\u064A]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u06C1\u06D5\u0647\u06BE]/g, 'ہ')
    .replace(/\s+/g, ' ');
}

export async function createRecoveryRecord(
  questions: RecoveryAnswerInput[],
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<RecoveryRecord> {
  if (questions.length < 2) {
    throw new PinPolicyError('Use at least two recovery questions');
  }
  return {
    v: PIN_RECORD_VERSION,
    algo: 'scrypt',
    params,
    questions: await Promise.all(
      questions.map(async q => {
        const normalized = normalizeAnswer(q.answer);
        if (normalized.length < 2) {throw new PinPolicyError('Recovery answers are too short');}
        const salt = bytesToHex(randomBytesSync(16));
        return {
          id: q.id,
          question: q.question,
          salt,
          hash: await derive(normalized, salt, params),
        };
      }),
    ),
  };
}

/**
 * Verifies every answer. Returns only a boolean so the UI can never reveal
 * which individual answer was wrong.
 */
export async function verifyRecovery(
  answers: { id: string; answer: string }[],
  record: RecoveryRecord | undefined,
): Promise<boolean> {
  if (!record || !record.questions.length) {return false;}
  const byId = new Map(answers.map(a => [a.id, a.answer]));
  let ok = true;
  for (const q of record.questions) {
    const given = byId.get(q.id);
    if (given === undefined) {ok = false; continue;}
    const candidate = await derive(normalizeAnswer(given), q.salt, record.params ?? DEFAULT_SCRYPT);
    if (!constantTimeEqual(candidate, q.hash)) {ok = false;}
  }
  return ok;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {return false;}
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Exponential back-off after repeated failures (documented in SECURITY.md). */
export function lockoutSeconds(failedAttempts: number): number {
  if (failedAttempts < 5) {return 0;}
  const step = Math.min(failedAttempts - 5, 5);
  return Math.min(300, 30 * Math.pow(2, step));
}

export const AUTO_LOCK_OPTIONS = [
  { value: '30s', ms: 30000 },
  { value: '1min', ms: 60000 },
  { value: '5min', ms: 300000 },
  { value: '10min', ms: 600000 },
  { value: '15min', ms: 900000 },
  { value: 'never', ms: 0 },
];

export function autoLockMs(value: string): number {
  return AUTO_LOCK_OPTIONS.find(o => o.value === value)?.ms ?? 60000;
}

/** Curated recovery questions (custom questions are allowed too). */
export const RECOVERY_QUESTIONS: { id: string; en: string; ur: string }[] = [
  { id: 'school', en: 'What was the name of your first school?', ur: 'آپ کے پہلے اسکول کا نام کیا تھا؟' },
  { id: 'teacher', en: 'What was the name of your first teacher?', ur: 'آپ کے پہلے استاد کا نام کیا تھا؟' },
  { id: 'friend', en: 'What was the name of your childhood best friend?', ur: 'بچپن کے بہترین دوست کا نام؟' },
  { id: 'city', en: 'In which city were you born?', ur: 'آپ کس شہر میں پیدا ہوئے؟' },
  { id: 'pet', en: 'What was the name of your first pet?', ur: 'آپ کے پہلے پالتو جانور کا نام؟' },
  { id: 'place', en: 'What was a memorable childhood place?', ur: 'بچپن کی یادگار جگہ کون سی تھی؟' },
  { id: 'game', en: 'What was your favourite childhood game?', ur: 'بچپن کا پسندیدہ کھیل؟' },
  { id: 'gift', en: 'What was a memorable gift you received as a child?', ur: 'بچپن میں ملی یادگار تحفہ؟' },
  { id: 'book', en: 'What was the name of your favourite childhood book?', ur: 'پسندیدہ بچپن کی کتاب کا نام؟' },
  { id: 'holiday', en: 'What was a memorable family holiday destination?', ur: 'خاندانی چھٹی کی یادگار جگہ؟' },
];

export interface SecureStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const PIN_STORAGE_KEY = 'pin_record_v1';
export const ATTEMPT_STORAGE_KEY = 'pin_attempts_v1';

/** In-memory adapter used by tests and as a development fallback. */
export class MemorySecureStorage implements SecureStorageAdapter {
  private map = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export class PinManager {
  constructor(private storage: SecureStorageAdapter) {}

  async hasPin(): Promise<boolean> {
    const raw = await this.storage.getItem(PIN_STORAGE_KEY);
    return !!raw;
  }

  async load(): Promise<PinRecord | null> {
    const raw = await this.storage.getItem(PIN_STORAGE_KEY);
    if (!raw) {return null;}
    try {
      return JSON.parse(raw) as PinRecord;
    } catch {
      return null;
    }
  }

  async setPin(pin: string, recovery?: { questions: RecoveryAnswerInput[] }): Promise<PinRecord> {
    const record = await createPinRecord(pin, recovery);
    await this.storage.setItem(PIN_STORAGE_KEY, JSON.stringify(record));
    return record;
  }

  async changePin(currentPin: string, newPin: string): Promise<void> {
    const record = await this.load();
    if (!record) {throw new PinPolicyError('No PIN is configured');}
    if (!(await verifyPin(currentPin, record))) {throw new PinPolicyError('Current PIN is incorrect');}
    validatePinFormat(newPin);
    const updated = await createPinRecord(newPin, undefined, record.params);
    updated.recovery = record.recovery;
    await this.storage.setItem(PIN_STORAGE_KEY, JSON.stringify(updated));
  }

  /**
   * Replaces the recovery questions without touching the PIN verifier, so the
   * caller never has to enter (or invent) a second PIN.
   */
  async setRecovery(questions: RecoveryAnswerInput[]): Promise<void> {
    const record = await this.load();
    if (!record) {throw new PinPolicyError('Set a PIN before adding recovery questions');}
    const recovery = await createRecoveryRecord(questions, record.params ?? DEFAULT_SCRYPT);
    await this.storage.setItem(PIN_STORAGE_KEY, JSON.stringify({ ...record, recovery }));
  }

  /** Turns the PIN lock off. Callers must verify the current PIN first. */
  async disablePin(currentPin: string): Promise<void> {
    const record = await this.load();
    if (!record) {return;}
    if (!(await verifyPin(currentPin, record))) {throw new PinPolicyError('Current PIN is incorrect');}
    await this.storage.removeItem(PIN_STORAGE_KEY);
    await this.storage.removeItem(ATTEMPT_STORAGE_KEY);
  }

  async unlock(pin: string): Promise<boolean> {
    const record = await this.load();
    if (!record) {return false;}
    return verifyPin(pin, record);
  }

  async recoveryQuestions(): Promise<{ id: string; question: string }[]> {
    const record = await this.load();
    return (record?.recovery?.questions ?? []).map(q => ({ id: q.id, question: q.question }));
  }

  async recoverWithAnswers(answers: { id: string; answer: string }[], newPin: string): Promise<void> {
    const record = await this.load();
    if (!record?.recovery) {throw new PinPolicyError('Recovery is not configured');}
    if (!(await verifyRecovery(answers, record.recovery))) {throw new PinPolicyError('Recovery answers are incorrect');}
    validatePinFormat(newPin);
    const updated = await createPinRecord(newPin, undefined, record.params);
    updated.recovery = record.recovery;
    await this.storage.setItem(PIN_STORAGE_KEY, JSON.stringify(updated));
  }
}
