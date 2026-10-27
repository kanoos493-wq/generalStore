/**
 * First-run setup wizard.
 *
 * Replaces the old behaviour where a brand new install opened directly on a
 * "choose a PIN" keypad. A new user now gets: welcome + language, shop profile,
 * operator, optional PIN with recovery questions, then a review screen that
 * opens the dashboard. Everything is written in one go when they press
 * "Start using DukanDost" (see appStore.finishOnboarding).
 *
 * The wizard is a plain view, not a navigation screen: it renders before the
 * navigator exists, so there is no back stack to build.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandMark, Button, Card, Field, PinPad, Row, SelectField, StepDots } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/appStore';
import {
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  RECOVERY_QUESTIONS,
  validatePinFormat,
} from '../../services/pinService';
import { messageOf } from '../../core/errors';
import type { Language } from '../../services/settingsService';

const STEPS = ['welcome', 'store', 'operator', 'security', 'review'] as const;
type Step = (typeof STEPS)[number];

function questionLabel(id: string): string {
  return RECOVERY_QUESTIONS.find(q => q.id === id)?.en ?? '';
}

export default function SetupWizardScreen() {
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const settings = useAppStore(s => s.settings);
  const hasPin = useAppStore(s => s.hasPin);
  const randomSourceReady = useAppStore(s => s.randomSourceReady);
  const applyLanguage = useAppStore(s => s.setLanguage);
  const finishOnboarding = useAppStore(s => s.finishOnboarding);

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** True when this device still needs a PIN created. */
  const needsPin = !hasPin;

  const [language, setLanguage] = useState<Language>(settings?.language ?? 'en');
  const [storeName, setStoreName] = useState('');
  const [storeNameUr, setStoreNameUr] = useState('');
  const [phone, setPhone] = useState(settings?.phone ?? '');
  const [address, setAddress] = useState(settings?.address ?? '');
  const [operatorName, setOperatorName] = useState(settings?.operatorName ?? 'Owner');

  const [pinEnabled, setPinEnabled] = useState(true);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinStage, setPinStage] = useState<'enter' | 'confirm'>('enter');
  const [recoveryEnabled, setRecoveryEnabled] = useState(true);
  const [questionOne, setQuestionOne] = useState(RECOVERY_QUESTIONS[0].id);
  const [questionTwo, setQuestionTwo] = useState(RECOVERY_QUESTIONS[3].id);
  const [answerOne, setAnswerOne] = useState('');
  const [answerTwo, setAnswerTwo] = useState('');

  const step: Step = STEPS[index];

  const questionOptions = useMemo(
    () => RECOVERY_QUESTIONS.map(q => ({ value: q.id, label: lang === 'ur' ? q.ur : q.en })),
    [lang],
  );

  const goBack = useCallback(() => {
    setError(null);
    if (pinStage === 'confirm' && STEPS[index] === 'security') {
      setPinStage('enter');
      setConfirmPin('');
      return;
    }
    setIndex(i => Math.max(0, i - 1));
  }, [index, pinStage]);

  // Android back: step back inside the wizard instead of leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0 && pinStage !== 'confirm') {
        return false;
      }
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [goBack, index, pinStage]);

  const chooseLanguage = (code: Language) => {
    setLanguage(code);
    if (settings?.language !== code) {
      void applyLanguage(code).catch(() => undefined);
    }
  };

  const validateStep = (): string | null => {
    if (step === 'store' && storeName.trim().length < 2) {
      return t('storeNameRequired');
    }
    if (step === 'security') {
      if (needsPin && pinEnabled) {
        try {
          validatePinFormat(pin);
        } catch (e) {
          return messageOf(e);
        }
        if (pin !== confirmPin) {
          return t('pinMismatch');
        }
        if (recoveryEnabled) {
          if (questionOne === questionTwo) {
            return t('questionsMustDiffer');
          }
          if (answerOne.trim().length < 2 || answerTwo.trim().length < 2) {
            return t('recoveryAnswersRequired');
          }
        }
      }
    }
    return null;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const recovery =
        needsPin && pinEnabled && recoveryEnabled
          ? [
              { id: questionOne, question: questionLabel(questionOne), answer: answerOne.trim() },
              { id: questionTwo, question: questionLabel(questionTwo), answer: answerTwo.trim() },
            ]
          : null;
      await finishOnboarding({
        storeName,
        storeNameUr,
        phone,
        address,
        language,
        operatorName,
        pin: needsPin && pinEnabled ? pin : null,
        recovery,
      });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    setError(null);
    // The PIN step collects two entries before it can be validated.
    if (step === 'security' && needsPin && pinEnabled && pinStage === 'enter') {
      try {
        validatePinFormat(pin);
        setPinStage('confirm');
      } catch (e) {
        setError(messageOf(e));
      }
      return;
    }
    const problem = validateStep();
    if (problem) {
      setError(problem);
      return;
    }
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
      return;
    }
    void submit();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <View style={styles.header}>
          <BrandMark size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.brand} numberOfLines={1}>
              {t('appName')}
            </Text>
            <Text style={styles.stepText}>{t('wizardStep', { n: index + 1, total: STEPS.length })}</Text>
          </View>
          <StepDots count={STEPS.length} index={index} />
        </View>

        {step === 'welcome' ? (
          <>
            <Card>
              <Text style={styles.title}>{t('wizardWelcomeTitle')}</Text>
              <Text style={styles.body}>{t('wizardWelcomeBody')}</Text>
            </Card>
            <Text style={styles.label}>{t('language')}</Text>
            <View style={styles.choices}>
              {(['en', 'ur'] as const).map(code => {
                const active = language === code;
                return (
                  <Pressable
                    key={code}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => chooseLanguage(code)}
                    style={[styles.choice, active && styles.choiceActive]}>
                    <Text style={[styles.choiceTitle, active && styles.choiceTextActive]}>
                      {code === 'en' ? 'English' : 'اردو'}
                    </Text>
                    <Text style={[styles.choiceSub, active && styles.choiceTextActive]}>
                      {code === 'en' ? 'Left to right' : 'دائیں سے بائیں'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.note}>{t('wizardOffline')}</Text>
          </>
        ) : null}

        {step === 'store' ? (
          <>
            <Text style={styles.title}>{t('wizardStoreTitle')}</Text>
            <Text style={styles.body}>{t('wizardStoreBody')}</Text>
            <Card>
              <Field
                testID="wizard-store-name"
                label={t('storeName')}
                value={storeName}
                onChangeText={setStoreName}
                placeholder={t('wizardStoreNameHint')}
                autoFocus
              />
              <Field label={t('nameUr')} value={storeNameUr} onChangeText={setStoreNameUr} placeholder="جنرل اسٹور" />
              <Field
                label={t('phone')}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="03xx-xxxxxxx"
              />
              <Field label={t('address')} value={address} onChangeText={setAddress} multiline />
            </Card>
          </>
        ) : null}

        {step === 'operator' ? (
          <>
            <Text style={styles.title}>{t('wizardOperatorTitle')}</Text>
            <Text style={styles.body}>{t('wizardOperatorBody')}</Text>
            <Card>
              <Field
                label={t('ownerName')}
                value={operatorName}
                onChangeText={setOperatorName}
                placeholder="Owner"
                autoFocus
              />
            </Card>
          </>
        ) : null}

        {step === 'security' ? (
          <>
            <Text style={styles.title}>{t('wizardSecurityTitle')}</Text>
            <Text style={styles.body}>{t('wizardSecurityBody')}</Text>

            {!needsPin ? (
              <Card>
                <Text style={styles.cardTitle}>{t('pinAlreadySet')}</Text>
                <Text style={styles.note}>{t('pinAlreadySetHint')}</Text>
              </Card>
            ) : (
              <>
                <Card>
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>{t('usePin')}</Text>
                    <Switch
                      testID="wizard-pin-toggle"
                      value={pinEnabled}
                      onValueChange={value => {
                        setPinEnabled(value);
                        setError(null);
                        setPin('');
                        setConfirmPin('');
                        setPinStage('enter');
                      }}
                      trackColor={{ true: colors.primary, false: colors.border }}
                      thumbColor={colors.card}
                    />
                  </View>
                </Card>

                {pinEnabled ? (
                  <Card>
                    <Text style={styles.label}>{pinStage === 'enter' ? t('setPin') : t('confirmPin')}</Text>
                    <PinPad
                      testID="wizard-pinpad"
                      value={pinStage === 'enter' ? pin : confirmPin}
                      onChange={value => (pinStage === 'enter' ? setPin(value) : setConfirmPin(value))}
                      minLength={PIN_MIN_LENGTH}
                      maxLength={PIN_MAX_LENGTH}
                    />
                    {pinStage === 'confirm' ? (
                      <Button
                        title={t('back')}
                        variant="ghost"
                        onPress={() => {
                          setPinStage('enter');
                          setConfirmPin('');
                          setError(null);
                        }}
                      />
                    ) : null}
                    {!randomSourceReady ? <Text style={styles.error}>{t('secureRandomMissing')}</Text> : null}
                  </Card>
                ) : null}

                {pinEnabled && pinStage === 'confirm' ? (
                  <Card>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>{t('recoveryOptional')}</Text>
                      <Switch
                        testID="wizard-recovery-toggle"
                        value={recoveryEnabled}
                        onValueChange={setRecoveryEnabled}
                        trackColor={{ true: colors.primary, false: colors.border }}
                        thumbColor={colors.card}
                      />
                    </View>
                    <Text style={styles.note}>{t('recoveryOptionalHint')}</Text>
                    {recoveryEnabled ? (
                      <>
                        <SelectField
                          label={`${t('question')} 1`}
                          value={questionOne}
                          options={questionOptions}
                          onChange={setQuestionOne}
                        />
                        <Field
                          testID="wizard-answer-1"
                          label={t('answer')}
                          value={answerOne}
                          onChangeText={setAnswerOne}
                        />
                        <SelectField
                          label={`${t('question')} 2`}
                          value={questionTwo}
                          options={questionOptions}
                          onChange={setQuestionTwo}
                        />
                        <Field
                          testID="wizard-answer-2"
                          label={t('answer')}
                          value={answerTwo}
                          onChangeText={setAnswerTwo}
                        />
                      </>
                    ) : null}
                  </Card>
                ) : null}
              </>
            )}
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <Text style={styles.title}>{t('wizardReviewTitle')}</Text>
            <Text style={styles.body}>{t('wizardReviewBody')}</Text>
            <Card>
              <Row label={t('storeLabel')} value={storeName.trim() || '—'} bold />
              <Row label={t('ownerLabel')} value={operatorName.trim() || 'Owner'} />
              <Row label={t('language')} value={language === 'ur' ? t('urdu') : t('english')} />
              <Row
                label={t('pinLabel')}
                value={needsPin ? (pinEnabled ? t('on') : t('off')) : t('on')}
              />
              <Row
                label={t('recoveryQuestions')}
                value={
                  needsPin && pinEnabled && recoveryEnabled ? `${questionLabel(questionOne)} / ${questionLabel(questionTwo)}` : t('recoveryNotSet')
                }
              />
            </Card>
            <Text style={styles.note}>{t('wizardFinishHint')}</Text>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.nav}>
          {index > 0 ? (
            <View style={{ flex: 1 }}>
              <Button title={t('back')} variant="ghost" onPress={goBack} />
            </View>
          ) : null}
          <View style={{ flex: index > 0 ? 1.3 : 1 }}>
            <Button
              testID="wizard-next"
              title={index === STEPS.length - 1 ? (busy ? t('saving') : t('startUsing')) : t('continue')}
              onPress={goNext}
              loading={busy}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  brand: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  stepText: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  body: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.md, lineHeight: 20 },
  label: { fontSize: font.sm, color: colors.muted, fontWeight: '600', marginBottom: spacing.sm },
  cardTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  note: { fontSize: font.xs, color: colors.muted, marginTop: spacing.sm, marginBottom: spacing.sm },
  choices: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  choice: {
    flex: 1,
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.md,
    justifyContent: 'center',
  },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  choiceSub: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  choiceTextActive: { color: colors.onPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  switchLabel: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  error: { color: colors.danger, fontWeight: '600', fontSize: font.sm, marginTop: spacing.sm },
  nav: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
});
