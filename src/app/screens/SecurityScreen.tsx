import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Field, LoadingView, ModalSheet, Row, Screen, Section, SelectField } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { pinManager, secureStorage, useAppStore } from '../store/appStore';
import { AUTO_LOCK_OPTIONS, RECOVERY_QUESTIONS, validatePinFormat } from '../../services/pinService';
import { messageOf } from '../../core/errors';

export default function SecurityScreen() {
  const { t, lang } = useI18n();
  const settings = useAppStore(s => s.settings);
  const saveSettings = useAppStore(s => s.saveSettings);
  const [loading, setLoading] = useState(true);
  const [autoLock, setAutoLock] = useState(settings?.autoLockTimeout ?? '1min');
  const [changeOpen, setChangeOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [answers, setAnswers] = useState([{ id: RECOVERY_QUESTIONS[0].id, question: RECOVERY_QUESTIONS[0].en, answer: '' }, { id: RECOVERY_QUESTIONS[3].id, question: RECOVERY_QUESTIONS[3].en, answer: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [hardware, setHardware] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const record = await pinManager.load();
      setHasRecovery(!!record?.recovery);
      setHardware(await secureStorage.isHardwareBacked());
      setLoading(false);
    })();
  }, []);

  if (loading) {return <LoadingView />;}

  const changePin = async () => {
    setBusy(true);
    setError(null);
    try {
      validatePinFormat(newPin);
      if (newPin !== confirmPin) {throw new Error(t('pinMismatch'));}
      await pinManager.changePin(currentPin, newPin);
      setChangeOpen(false);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      Alert.alert(t('save'));
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
      const record = await pinManager.load();
      if (!record) {throw new Error('No PIN configured');}
      const filled = answers.filter(a => a.answer.trim().length > 1);
      if (filled.length < 2) {throw new Error(t('answerHint'));}
      const verified = await pinManager.unlock(currentPin);
      if (!verified) {throw new Error(t('wrongPin'));}
      // re-enrol the record with recovery questions (same PIN)
      const { createRecoveryRecord } = await import('../../services/pinService');
      const recovery = createRecoveryRecord(filled, record.params);
      const updated = { ...record, recovery };
      await secureStorage.setItem('pin_record_v1', JSON.stringify(updated));
      setHasRecovery(true);
      setRecoveryOpen(false);
      await saveSettings({ pin_recovery_enabled: '1' });
      Alert.alert(t('save'));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.title}>{t('security')}</Text>
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
        <Row label="PIN" value={t('changePin')} />
        <Row label={t('recoveryQuestions')} value={hasRecovery ? '✓' : '—'} />
        <Row label="Keystore" value={hardware ? 'hardware-backed ✓' : 'unavailable'} tone={hardware ? 'success' : 'danger'} />
      </Card>

      <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
        <Text style={{ color: colors.warning, fontSize: font.sm }}>{t('recoveryHint')}</Text>
        <Text style={{ color: colors.warning, fontSize: font.sm, marginTop: spacing.sm }}>{t('backupCaution')}</Text>
      </Card>

      <Section title={t('security')}>
        <Button title={t('changePin')} variant="secondary" onPress={() => { setChangeOpen(true); setError(null); }} />
        <View style={{ height: spacing.sm }} />
        <Button
          title={hasRecovery ? t('recoveryQuestions') : `${t('recoveryQuestions')} +`}
          variant="secondary"
          onPress={() => { setRecoveryOpen(true); setError(null); }}
        />
      </Section>

      <ModalSheet
        visible={changeOpen}
        onClose={() => setChangeOpen(false)}
        title={t('changePin')}
        footer={<Button title={busy ? t('saving') : t('save')} onPress={changePin} loading={busy} />}>
        <Field label="Current PIN" value={currentPin} onChangeText={setCurrentPin} keyboardType="number-pad" secure />
        <Field label={t('setPin')} value={newPin} onChangeText={setNewPin} keyboardType="number-pad" secure />
        <Field label={t('confirmPin')} value={confirmPin} onChangeText={setConfirmPin} keyboardType="number-pad" secure />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ModalSheet>

      <ModalSheet
        visible={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        title={t('recoveryQuestions')}
        footer={<Button title={busy ? t('saving') : t('save')} onPress={saveRecovery} loading={busy} />}>
        <Field label="Current PIN" value={currentPin} onChangeText={setCurrentPin} keyboardType="number-pad" secure />
        {answers.map((answer, index) => (
          <Card key={index}>
            <SelectField
              label={`${t('recoveryQuestions')} ${index + 1}`}
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
              label="Answer"
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
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.sm },
});
