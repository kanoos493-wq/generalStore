import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '../components';
import { colors, font, radius, spacing, touchTarget } from '../theme';
import { useI18n } from '../i18n';
import { pinManager, secureStorage, useAppStore } from '../store/appStore';
import {
  ATTEMPT_STORAGE_KEY,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  RECOVERY_QUESTIONS,
  lockoutSeconds,
  validatePinFormat,
  type RecoveryAnswerInput,
} from '../../services/pinService';
import { messageOf } from '../../core/errors';

type Mode = 'unlock' | 'setup' | 'recovery' | 'recovery-setup';

interface AttemptState {
  failed: number;
  until: number;
}

export default function LockScreen() {
  const { t } = useI18n();
  const needsSetup = useAppStore(s => s.needsSetup);
  const unlockApp = useAppStore(s => s.unlock);
  const completeSetup = useAppStore(s => s.completeSetup);

  const [mode, setMode] = useState<Mode>(needsSetup ? 'setup' : 'unlock');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState<'pin' | 'confirm'>('pin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<AttemptState>({ failed: 0, until: 0 });
  const [now, setNow] = useState(Date.now());

  const [recoveryQuestions, setRecoveryQuestions] = useState<{ id: string; question: string }[]>([]);
  const [recoveryAnswers, setRecoveryAnswers] = useState<Record<string, string>>({});
  const [newPin, setNewPin] = useState('');
  const [setupAnswers, setSetupAnswers] = useState<RecoveryAnswerInput[]>([]);

  useEffect(() => {
    void (async () => {
      const raw = await secureStorage.getItem(ATTEMPT_STORAGE_KEY);
      if (raw) {
        try {
          setAttempts(JSON.parse(raw) as AttemptState);
        } catch {
          // ignore corrupt state
        }
      }
    })();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const lockedFor = Math.max(0, Math.ceil((attempts.until - now) / 1000));

  const persistAttempts = useCallback(async (next: AttemptState) => {
    setAttempts(next);
    await secureStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const reset = useCallback(() => {
    setPin('');
    setConfirm('');
    setStage('pin');
    setError(null);
  }, []);

  const submitUnlock = useCallback(
    async (entered: string) => {
      if (lockedFor > 0 || busy) {return;}
      setBusy(true);
      try {
        const ok = await pinManager.unlock(entered);
        if (ok) {
          await persistAttempts({ failed: 0, until: 0 });
          unlockApp();
        } else {
          const failed = attempts.failed + 1;
          const seconds = lockoutSeconds(failed);
          await persistAttempts({ failed, until: seconds ? Date.now() + seconds * 1000 : 0 });
          setError(t('wrongPin'));
          reset();
        }
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    [attempts.failed, busy, lockedFor, persistAttempts, reset, t, unlockApp],
  );

  useEffect(() => {
    if (mode !== 'unlock' || lockedFor > 0) {return;}
    if (pin.length === PIN_MAX_LENGTH) {void submitUnlock(pin);}
    else if (pin.length >= PIN_MIN_LENGTH) {
      // auto-submit at the configured length once it matches the stored one
      void (async () => {
        const record = await pinManager.load();
        if (record && pin.length === record.pinLength) {void submitUnlock(pin);}
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const pressDigit = (digit: string) => {
    if (busy || lockedFor > 0) {return;}
    setError(null);
    setPin(p => (p.length >= PIN_MAX_LENGTH ? p : `${p}${digit}`));
  };

  const pressBack = () => {
    setError(null);
    setPin(p => p.slice(0, -1));
  };

  const beginSetup = async () => {
    setError(null);
    try {
      validatePinFormat(pin);
      if (pin !== confirm) {throw new Error(t('pinMismatch'));}
      setStage('pin');
      setMode('recovery-setup');
      setSetupAnswers([
        { id: RECOVERY_QUESTIONS[0].id, question: t(RECOVERY_QUESTIONS[0].id) === RECOVERY_QUESTIONS[0].id ? RECOVERY_QUESTIONS[0].en : RECOVERY_QUESTIONS[0].en, answer: '' },
        { id: RECOVERY_QUESTIONS[3].id, question: RECOVERY_QUESTIONS[3].en, answer: '' },
      ]);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const finishSetup = async (withRecovery: boolean) => {
    setBusy(true);
    try {
      validatePinFormat(pin);
      const questions = withRecovery
        ? setupAnswers.filter(a => a.answer.trim().length > 1)
        : [];
      if (withRecovery && questions.length < 2) {
        throw new Error(t('answerHint'));
      }
      await pinManager.setPin(pin, questions.length ? { questions } : undefined);
      if (withRecovery) {
        await useAppStore.getState().saveSettings({ pin_recovery_enabled: '1' });
      }
      await completeSetup();
    } catch (e) {
      setError(messageOf(e));
      if (mode === 'recovery-setup') {setMode('setup');}
    } finally {
      setBusy(false);
    }
  };

  const openRecovery = async () => {
    const questions = await pinManager.recoveryQuestions();
    setRecoveryQuestions(questions);
    setRecoveryAnswers({});
    setNewPin('');
    setError(null);
    setMode('recovery');
  };

  const submitRecovery = async () => {
    setBusy(true);
    try {
      validatePinFormat(newPin);
      await pinManager.recoverWithAnswers(
        recoveryQuestions.map(q => ({ id: q.id, answer: recoveryAnswers[q.id] ?? '' })),
        newPin,
      );
      await persistAttempts({ failed: 0, until: 0 });
      unlockApp();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const keypad = useMemo(() => ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'], []);

  const renderPinDots = (value: string) => (
    <View style={styles.dots}>
      {Array.from({ length: Math.max(PIN_MIN_LENGTH, value.length) }).map((_, i) => (
        <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
      ))}
    </View>
  );

  if (mode === 'recovery') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('recoveryQuestions')}</Text>
          <Text style={styles.warn}>{t('recoveryHint')}</Text>
          {recoveryQuestions.length === 0 ? (
            <Text style={styles.warn}>{t('noRecovery')}</Text>
          ) : (
            recoveryQuestions.map(q => (
              <View key={q.id} style={{ marginBottom: spacing.md }}>
                <Text style={styles.label}>{q.question}</Text>
                <TextInput
                  style={styles.input}
                  value={recoveryAnswers[q.id] ?? ''}
                  onChangeText={v => setRecoveryAnswers(prev => ({ ...prev, [q.id]: v }))}
                  autoCapitalize="none"
                  placeholder="—"
                  placeholderTextColor={colors.faint}
                />
              </View>
            ))
          )}
          {recoveryQuestions.length > 0 && (
            <>
              <Text style={styles.label}>{t('setPin')}</Text>
              <TextInput
                style={styles.input}
                value={newPin}
                onChangeText={setNewPin}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_MAX_LENGTH}
                placeholder={`${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH}`}
                placeholderTextColor={colors.faint}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submitRecovery} disabled={busy}>
                <Text style={styles.primaryBtnText}>{t('unlock')}</Text>
              </Pressable>
            </>
          )}
          <Pressable onPress={() => { setMode('unlock'); setError(null); }} style={styles.linkBtn}>
            <Text style={styles.link}>{t('back')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (mode === 'recovery-setup') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('recoveryQuestions')}</Text>
          <Text style={styles.warn}>{t('recoveryHint')}</Text>
          {setupAnswers.map((answer, index) => (
            <View key={index} style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>{answer.question}</Text>
              <TextInput
                style={styles.input}
                value={answer.answer}
                onChangeText={v =>
                  setSetupAnswers(prev => prev.map((a, i) => (i === index ? { ...a, answer: v } : a)))
                }
                autoCapitalize="none"
                placeholder="—"
                placeholderTextColor={colors.faint}
              />
              <View style={styles.chips}>
                {RECOVERY_QUESTIONS.slice(0, 6).map(q => (
                  <Pressable
                    key={q.id}
                    onPress={() =>
                      setSetupAnswers(prev =>
                        prev.map((a, i) => (i === index ? { ...a, id: q.id, question: q.en } : a)),
                      )
                    }
                    style={[styles.chip, answer.id === q.id && styles.chipActive]}>
                    <Text style={[styles.chipText, answer.id === q.id && styles.chipTextActive]} numberOfLines={1}>
                      {q.en.replace(/\?$/, '')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.primaryBtn} onPress={() => finishSetup(true)} disabled={busy}>
            <Text style={styles.primaryBtnText}>{t('save')}</Text>
          </Pressable>
          <Pressable style={styles.linkBtn} onPress={() => finishSetup(false)} disabled={busy}>
            <Text style={styles.link}>{t('skipForNow')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (mode === 'setup') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <BrandMark size={72} />
        <Text style={styles.title}>DukanDost</Text>
        <Text style={styles.title}>{t('setupTitle')}</Text>
          <Text style={styles.body}>{t('setupBody')}</Text>
          <Text style={styles.label}>{stage === 'pin' ? t('setPin') : t('confirmPin')}</Text>
          {renderPinDots(stage === 'pin' ? pin : confirm)}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.keypad}>
            {keypad.map((key, i) =>
              key === '' ? (
                <View key={i} style={styles.key} />
              ) : (
                <Pressable
                  key={i}
                  onPress={() => {
                    setError(null);
                    const setter = stage === 'pin' ? setPin : setConfirm;
                    const current = stage === 'pin' ? pin : confirm;
                    if (key === '⌫') {
                      setter(current.slice(0, -1));
                    } else if (current.length < PIN_MAX_LENGTH) {
                      setter(`${current}${key}`);
                    }
                  }}
                  style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.primarySoft }]}>
                  <Text style={styles.keyText}>{key}</Text>
                </Pressable>
              ),
            )}
          </View>
          <Pressable
            style={[styles.primaryBtn, { width: '100%' }]}
            onPress={() => {
              if (stage === 'pin') {
                try {
                  validatePinFormat(pin);
                  setStage('confirm');
                  setError(null);
                } catch (e) {
                  setError(messageOf(e));
                }
              } else {
                void beginSetup();
              }
            }}>
            <Text style={styles.primaryBtnText}>{stage === 'pin' ? t('continue') : t('save')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <BrandMark size={88} />
        <Text style={styles.title}>DukanDost</Text>
        <Text style={styles.title}>{t('enterPin')}</Text>
        {renderPinDots(pin)}
        {lockedFor > 0 ? (
          <Text style={styles.error}>
            {t('lockedFor')} {lockedFor}
            {t('seconds')}
          </Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}
        <View style={styles.keypad}>
          {keypad.map((key, i) =>
            key === '' ? (
              <View key={i} style={styles.key} />
            ) : (
              <Pressable
                key={i}
                onPress={() => (key === '⌫' ? pressBack() : pressDigit(key))}
                style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.primarySoft }]}>
                <Text style={styles.keyText}>{key}</Text>
              </Pressable>
            ),
          )}
        </View>
        <Pressable onPress={openRecovery} style={styles.linkBtn}>
          <Text style={styles.link}>{t('forgotPin')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: spacing.xs, textAlign: 'center' },
  body: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginBottom: spacing.lg },
  label: { fontSize: font.sm, color: colors.muted, fontWeight: '600', marginBottom: spacing.xs },
  warn: {
    fontSize: font.sm,
    color: colors.warning,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  dots: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: colors.primary },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 288, marginVertical: spacing.md },
  key: {
    width: 96,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  keyText: { fontSize: font.xl, fontWeight: '600', color: colors.text },
  primaryBtn: {
    backgroundColor: colors.primary,
    minHeight: touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
    width: '100%',
  },
  primaryBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: font.md },
  linkBtn: { padding: spacing.md, marginTop: spacing.sm },
  link: { color: colors.primary, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.card,
  },
  error: { color: colors.danger, fontWeight: '600', textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    maxWidth: 170,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.xs, color: colors.muted },
  chipTextActive: { color: colors.onPrimary },
});
