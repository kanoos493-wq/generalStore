/**
 * Security settings: auto-lock, the PIN itself, and recovery questions.
 *
 * Each action is a single modal that does one thing - creating the PIN never
 * asks for it again, and enrolling recovery questions does not re-enrol the PIN
 * (the app is already unlocked, and the questions are written on their own).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, LoadingView, ModalSheet, Row, Screen, Section, SelectField } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { pinManager, secureStorage, useAppStore } from '../store/appStore';
import { AUTO_LOCK_OPTIONS, RECOVERY_QUESTIONS, validatePinFormat } from '../../services/pinService';
import { messageOf } from '../../core/errors';

interface AnswerDraft {
  id: string;
  question: string;
  answer: string;
}

function defaultAnswers(): AnswerDraft[] {
  return [
    { id: RECOVERY_QUESTIONS[0].id, question: RECOVERY_QUESTIONS[0].en, answer: '' },
    { id: RECOVERY_QUESTIONS[3].id, question: RECOVERY_QUESTIONS[3].en, answer: '' },
  ];
}

export default function SecurityScreen() {
  const { t, lang } = useI18n();
  const settings = useAppStore(s => s.settings);
  const saveSettings = useAppStore(s => s.saveSettings);
  const hasPin = useAppStore(s => s.hasPin);
  const randomSourceReady = useAppStore(s => s.randomSourceReady);
  const refreshSecurityState = useAppStore(s => s.refreshSecurityState);

  const [loading, setLoading] = useState(true);
  const [autoLock, setAutoLock] = useState(settings?.autoLockTimeout ?? '1min');
  const [hardware, setHardware] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);

  const [pinModal, setPinModal] = useState<'set' | 'change' | 'disable' | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [answers, setAnswers] = useState<AnswerDraft[]>(defaultAnswers);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const record = await pinManager.load();
    setHasRecovery(!!record?.recovery);
    setHardware(await secureStorage.isHardwareBacked());
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const closePinModal = () => {
    setPinModal(null);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
  };

  const savePin = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pinModal === 'disable') {
        await pinManager.disablePin(currentPin);
        await saveSettings({ pin_enabled: '0' });
        await refreshSecurityState();
        closePinModal();
        return;
      }
      validatePinFormat(newPin);
      if (newPin !== confirmPin) {throw new Error(t('pinMismatch'));}
      if (pinModal === 'change') {
        await pinManager.changePin(currentPin, newPin);
      } else {
        await pinManager.setPin(newPin);
        await saveSettings({ pin_enabled: '1' });
      }
      await refreshSecurityState();
      closePinModal();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const saveRecovery = async () => {
    setBusy(true);
    setError(null);
    try {
      const filled = answers.filter(a => a.answer.trim().length > 1);
      if (filled.length < 2) {throw new Error(t('answerHint'));}
      if (filled[0].id === filled[1].id) {throw new Error(t('questionsMustDiffer'));}
      await pinManager.setRecovery(filled.map(a => ({ id: a.id, question: a.question, answer: a.answer })));
      await saveSettings({ pin_recovery_enabled: '1' });
      setHasRecovery(true);
      setRecoveryOpen(false);
      setAnswers(defaultAnswers());
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {return <LoadingView />;}

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.title}>{t('security')}</Text>
        <Row label={t('security')} value={hasPin ? t('on') : t('off')} tone={hasPin ? 'success' : 'default'} />
        <Row label={t('recoveryQuestions')} value={hasRecovery ? '✓' : '—'} />
        <Row
          label="Keystore"
          value={hardware ? 'hardware-backed ✓' : 'unavailable'}
          tone={hardware ? 'success' : 'danger'}
        />
        <SelectField
          label={t('autoLock')}
          value={autoLock}
          options={AUTO_LOCK_OPTIONS.map(o => ({
            value: o.value,
            label: o.value === 'never' ? (lang === 'ur' ? 'کبھی نہیں' : 'Never') : o.value,
          }))}
          onChange={value => {
            setAutoLock(value);
            void saveSettings({ auto_lock_timeout: value });
          }}
        />
      </Card>

      {!randomSourceReady ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}>
          <Text style={{ color: colors.danger, fontSize: font.sm }}>{t('secureRandomMissing')}</Text>
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
        <Text style={{ color: colors.warning, fontSize: font.sm }}>{t('recoveryHint')}</Text>
        <Text style={{ color: colors.warning, fontSize: font.sm, marginTop: spacing.sm }}>{t('backupCaution')}</Text>
      </Card>

      <Section title={t('pinLabel')}>
        {hasPin ? (
          <>
            <Button title={t('changePin')} variant="secondary" onPress={() => { setError(null); setPinModal('change'); }} />
            <View style={{ height: spacing.sm }} />
            <Button
              title={t('turnOffPin')}
              variant="ghost"
              onPress={() => { setError(null); setPinModal('disable'); }}
            />
          </>
        ) : (
          <Button title={t('setPin')} onPress={() => { setError(null); setPinModal('set'); }} />
        )}
      </Section>

      <Section title={t('recoveryQuestions')}>
        <Button
          title={hasRecovery ? t('changeRecovery') : t('setRecovery')}
          variant="secondary"
          disabled={!hasPin}
          onPress={() => { setError(null); setRecoveryOpen(true); }}
        />
        {!hasPin ? <Text style={styles.hint}>{t('recoveryNeedsPin')}</Text> : null}
      </Section>

      <ModalSheet
        visible={pinModal !== null}
        onClose={closePinModal}
        title={pinModal === 'disable' ? t('turnOffPin') : pinModal === 'change' ? t('changePin') : t('setPin')}
        footer={
          <Button
            title={busy ? t('saving') : t('save')}
            variant={pinModal === 'disable' ? 'danger' : 'primary'}
            onPress={savePin}
            loading={busy}
          />
        }>
        {pinModal === 'change' || pinModal === 'disable' ? (
          <Field label={t('currentPin')} value={currentPin} onChangeText={setCurrentPin} keyboardType="number-pad" secure />
        ) : null}
        {pinModal !== 'disable' ? (
          <>
            <Field
              label={t('setPin')}
              value={newPin}
              onChangeText={setNewPin}
              keyboardType="number-pad"
              maxLength={8}
              secure
            />
            <Field
              label={t('confirmPin')}
              value={confirmPin}
              onChangeText={setConfirmPin}
              keyboardType="number-pad"
              maxLength={8}
              secure
            />
          </>
        ) : (
          <Text style={styles.hint}>{t('turnOffPinHint')}</Text>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ModalSheet>

      <ModalSheet
        visible={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title={t('recoveryQuestions')}
        footer={<Button title={busy ? t('saving') : t('save')} onPress={saveRecovery} loading={busy} />}>
        <Text style={styles.hint}>{t('recoveryOptionalHint')}</Text>
        {answers.map((answer, index) => (
          <Card key={index}>
            <SelectField
              label={`${t('question')} ${index + 1}`}
              value={answer.id}
              options={RECOVERY_QUESTIONS.map(q => ({ value: q.id, label: lang === 'ur' ? q.ur : q.en }))}
              onChange={value =>
                setAnswers(prev =>
                  prev.map((a, i) =>
                    i === index
                      ? { ...a, id: value, question: RECOVERY_QUESTIONS.find(q => q.id === value)?.en ?? '' }
                      : a,
                  ),
                )
              }
            />
            <Field
              label={t('answer')}
              value={answer.answer}
              onChangeText={value => setAnswers(prev => prev.map((a, i) => (i === index ? { ...a, answer: value } : a)))}
            />
          </Card>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  hint: { fontSize: font.xs, color: colors.muted, marginTop: spacing.sm },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.sm },
});
