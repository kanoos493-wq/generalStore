/**
 * Lock screen.
 *
 * Only reachable when a PIN exists: first-run setup and PIN creation live in
 * SetupWizardScreen, so this screen never asks a new user to invent a PIN and
 * never prompts twice for the same step.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark, Field, PinPad } from '../components';
import { colors, font, radius, spacing, touchTarget } from '../theme';
import { useI18n } from '../i18n';
import { pinManager, secureStorage, useAppStore } from '../store/appStore';
import {
  ATTEMPT_STORAGE_KEY,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  lockoutSeconds,
  validatePinFormat,
} from '../../services/pinService';
import { messageOf } from '../../core/errors';

interface AttemptState {
  failed: number;
  until: number;
}

export default function LockScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const unlockApp = useAppStore(s => s.unlock);
  const refreshSecurityState = useAppStore(s => s.refreshSecurityState);

  const [mode, setMode] = useState<'unlock' | 'recovery'>('unlock');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState<AttemptState>({ failed: 0, until: 0 });
  const [now, setNow] = useState(Date.now());

  const [questions, setQuestions] = useState<{ id: string; question: string }[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  useEffect(() => {
    void (async () => {
      const raw = await secureStorage.getItem(ATTEMPT_STORAGE_KEY);
      if (raw) {
        try {
          setAttempts(JSON.parse(raw) as AttemptState);
        } catch {
          // ignore corrupt attempt state
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
          setPin('');
        }
      } catch (e) {
        setError(messageOf(e));
        setPin('');
      } finally {
        setBusy(false);
      }
    },
    [attempts.failed, busy, lockedFor, persistAttempts, t, unlockApp],
  );

  // Submit once the entered length matches the stored PIN's length.
  useEffect(() => {
    if (mode !== 'unlock' || lockedFor > 0 || busy) {return;}
    if (pin.length < PIN_MIN_LENGTH) {return;}
    void (async () => {
      const record = await pinManager.load();
      if (!record) {
        // The PIN verifier vanished (for example after clearing app data):
        // stop pretending the app is locked instead of trapping the user.
        await refreshSecurityState();
        return;
      }
      if (pin.length === Math.min(PIN_MAX_LENGTH, record.pinLength)) {
        void submitUnlock(pin);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, mode, lockedFor, busy]);

  const openRecovery = async () => {
    const listed = await pinManager.recoveryQuestions();
    setQuestions(listed);
    setAnswers({});
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setMode('recovery');
  };

  const submitRecovery = async () => {
    setBusy(true);
    setError(null);
    try {
      validatePinFormat(newPin);
      if (newPin !== confirmPin) {throw new Error(t('pinMismatch'));}
      await pinManager.recoverWithAnswers(
        questions.map(q => ({ id: q.id, answer: answers[q.id] ?? '' })),
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

  if (mode === 'recovery') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('recoveryQuestions')}</Text>
          <Text style={styles.warn}>{t('recoveryHint')}</Text>
          {questions.length === 0 ? (
            <Text style={styles.warn}>{t('noRecovery')}</Text>
          ) : (
            questions.map(q => (
              <Field
                key={q.id}
                label={q.question}
                value={answers[q.id] ?? ''}
                onChangeText={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
              />
            ))
          )}
          {questions.length > 0 ? (
            <>
              <Field
                label={t('setPin')}
                value={newPin}
                onChangeText={setNewPin}
                keyboardType="number-pad"
                maxLength={PIN_MAX_LENGTH}
                secure
              />
              <Field
                label={t('confirmPin')}
                value={confirmPin}
                onChangeText={setConfirmPin}
                keyboardType="number-pad"
                maxLength={PIN_MAX_LENGTH}
                secure
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submitRecovery} disabled={busy}>
                <Text style={styles.primaryBtnText}>{t('unlock')}</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={() => {
              setMode('unlock');
              setError(null);
            }}
            style={styles.linkBtn}>
            <Text style={styles.link}>{t('back')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <BrandMark size={88} />
        <Text style={styles.brand}>DukanDost</Text>
        <Text style={styles.subtitle}>{t('enterPin')}</Text>
        <PinPad
          testID="lock-pinpad"
          value={pin}
          onChange={value => {
            setError(null);
            setPin(value);
          }}
          minLength={PIN_MIN_LENGTH}
          maxLength={PIN_MAX_LENGTH}
          disabled={busy || lockedFor > 0}
        />
        {lockedFor > 0 ? (
          <Text style={styles.error}>
            {t('lockedFor')} {lockedFor}
            {t('seconds')}
          </Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}
        <Pressable onPress={openRecovery} style={styles.linkBtn}>
          <Text style={styles.link}>{t('forgotPin')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  brand: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: spacing.xs, textAlign: 'center' },
  subtitle: { fontSize: font.sm, color: colors.muted, textAlign: 'center', marginBottom: spacing.sm },
  warn: {
    fontSize: font.sm,
    color: colors.warning,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    minHeight: touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  primaryBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: font.md },
  linkBtn: { padding: spacing.md, marginTop: spacing.sm },
  link: { color: colors.primary, fontWeight: '600' },
  error: { color: colors.danger, fontWeight: '600', textAlign: 'center' },
});
