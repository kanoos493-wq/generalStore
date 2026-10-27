import {
  MemorySecureStorage,
  PIN_STORAGE_KEY,
  PinManager,
  autoLockMs,
  createPinRecord,
  createRecoveryRecord,
  lockoutSeconds,
  normalizeAnswer,
  validatePinFormat,
  verifyPin,
  verifyRecovery,
  type RecoveryAnswerInput,
} from '../../src/services/pinService';

const fast = { N: 1024, r: 8, p: 1, dkLen: 32 };

const answers: RecoveryAnswerInput[] = [
  { id: 'school', question: 'First school?', answer: 'St. Mary' },
  { id: 'city', question: 'Birth city?', answer: 'Lahore' },
];

describe('PIN records', () => {
  it('never stores the PIN itself', async () => {
    const record = await createPinRecord('4827', undefined, fast);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain('4827');
    expect(record.hash).toHaveLength(64);
    expect(record.salt).toHaveLength(32);
  });

  it('verifies the correct PIN and rejects others', async () => {
    const record = await createPinRecord('4827', undefined, fast);
    expect(await verifyPin('4827', record)).toBe(true);
    expect(await verifyPin('4828', record)).toBe(false);
    expect(await verifyPin('', record)).toBe(false);
  });

  it('produces a different verifier for the same PIN on another device', async () => {
    const a = await createPinRecord('4827', undefined, fast);
    const b = await createPinRecord('4827', undefined, fast);
    expect(a.hash).not.toBe(b.hash);
  });

  it('enforces the PIN policy', () => {
    expect(() => validatePinFormat('12')).toThrow(/4-8 digits/);
    expect(() => validatePinFormat('abcd')).toThrow(/digits/);
    expect(() => validatePinFormat('1111')).toThrow(/predictable/);
    expect(() => validatePinFormat('4827')).not.toThrow();
  });
});

describe('recovery questions', () => {
  it('requires at least two questions', async () => {
    await expect(createRecoveryRecord([answers[0]], fast)).rejects.toThrow(/two recovery questions/);
  });

  it('verifies all answers and never reveals which one failed', async () => {
    const record = await createRecoveryRecord(answers, fast);
    expect(await verifyRecovery(answers, record)).toBe(true);
    const wrong = [{ ...answers[0], answer: 'something else' }, answers[1]];
    const result = await verifyRecovery(wrong, record);
    expect(result).toBe(false);
    expect(typeof result).toBe('boolean');
  });

  it('normalises case, spacing and Urdu letter variants', async () => {
    expect(normalizeAnswer('  St.  MARY ')).toBe('st. mary');
    expect(normalizeAnswer('لاھور')).toBe('لاہور');
    const record = await createRecoveryRecord(
      [
        { id: 'a', question: 'q1', answer: 'Lahore' },
        { id: 'b', question: 'q2', answer: '  Model Town ' },
      ],
      fast,
    );
    expect(
      await verifyRecovery(
        [
          { id: 'a', answer: 'LAHORE' },
          { id: 'b', answer: 'model town' },
        ],
        record,
      ),
    ).toBe(true);
  });
});

describe('lockout policy', () => {
  it('allows five free attempts then backs off exponentially', () => {
    expect(lockoutSeconds(1)).toBe(0);
    expect(lockoutSeconds(4)).toBe(0);
    expect(lockoutSeconds(5)).toBe(30);
    expect(lockoutSeconds(6)).toBe(60);
    expect(lockoutSeconds(7)).toBe(120);
    expect(lockoutSeconds(20)).toBe(300);
  });

  it('maps auto-lock settings to milliseconds', () => {
    expect(autoLockMs('30s')).toBe(30000);
    expect(autoLockMs('1min')).toBe(60000);
    expect(autoLockMs('never')).toBe(0);
    expect(autoLockMs('unknown')).toBe(60000);
  });
});

describe('PinManager', () => {
  it('stores only the verifier and unlocks with the right PIN', async () => {
    const storage = new MemorySecureStorage();
    const manager = new PinManager(storage);
    expect(await manager.hasPin()).toBe(false);
    await manager.setPin('4827', { questions: answers });
    expect(await manager.hasPin()).toBe(true);
    expect(await storage.getItem(PIN_STORAGE_KEY)).not.toContain('4827');
    expect(await manager.unlock('4827')).toBe(true);
    expect(await manager.unlock('0000')).toBe(false);
  });

  it('requires the current PIN to change it', async () => {
    const manager = new PinManager(new MemorySecureStorage());
    await manager.setPin('4827');
    await expect(manager.changePin('9999', '5731')).rejects.toThrow(/incorrect/);
    await manager.changePin('4827', '5731');
    expect(await manager.unlock('5731')).toBe(true);
    expect(await manager.unlock('4827')).toBe(false);
  });

  it('enrols recovery questions without touching the PIN', async () => {
    const manager = new PinManager(new MemorySecureStorage());
    await manager.setPin('4827');
    const before = await manager.load();
    await manager.setRecovery(answers);
    const after = await manager.load();
    // Same verifier, same salt: the PIN was not re-derived or re-prompted.
    expect(after?.hash).toBe(before?.hash);
    expect(after?.salt).toBe(before?.salt);
    expect(await manager.recoveryQuestions()).toHaveLength(2);
    expect(await manager.unlock('4827')).toBe(true);
  });

  it('refuses recovery questions before a PIN exists', async () => {
    const manager = new PinManager(new MemorySecureStorage());
    await expect(manager.setRecovery(answers)).rejects.toThrow(/Set a PIN/);
  });

  it('turns the PIN off only with the current PIN', async () => {
    const manager = new PinManager(new MemorySecureStorage());
    await manager.setPin('4827');
    await expect(manager.disablePin('9999')).rejects.toThrow(/incorrect/);
    expect(await manager.hasPin()).toBe(true);
    await manager.disablePin('4827');
    expect(await manager.hasPin()).toBe(false);
    expect(await manager.unlock('4827')).toBe(false);
  });

  it('recovers with the right answers and keeps the same recovery set', async () => {
    const manager = new PinManager(new MemorySecureStorage());
    await manager.setPin('4827', { questions: answers });
    const listed = await manager.recoveryQuestions();
    expect(listed).toHaveLength(2);
    await expect(
      manager.recoverWithAnswers([{ id: 'school', answer: 'nope' }, { id: 'city', answer: 'Lahore' }], '9182'),
    ).rejects.toThrow(/Recovery answers are incorrect/);
    await manager.recoverWithAnswers(answers, '9182');
    expect(await manager.unlock('9182')).toBe(true);
    expect(await manager.recoveryQuestions()).toHaveLength(2);
  });
});
