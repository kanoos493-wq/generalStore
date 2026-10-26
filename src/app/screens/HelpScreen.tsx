import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card, Row, Screen, Section } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/appStore';
import { LATEST_SCHEMA_VERSION } from '../../db/schema';

const VERSION = '1.0.0';

export default function HelpScreen() {
  const { lang } = useI18n();
  const db = useAppStore(s => s.db);
  const settings = useAppStore(s => s.settings);
  const ur = lang === 'ur';

  const points = ur
    ? [
        'ایپ مکمل طور پر آف لائن چلتی ہے۔ کوئی انٹرنیٹ یا اکاؤنٹ لازمی نہیں۔',
        'ہر اسٹاک اور مالی تبدیلی ایک ناقابلِ تبدیل اندراج بناتی ہے۔',
        'مالی حساب کتاب 100 روپے = 10000 پیسے کی طرح عددی طور پر ہوتا ہے، اعشاریہ غلطیاں نہیں۔',
        'قیمتیں دستاویز بننے کے وقت محفوظ ہو جاتی ہیں، بعد کی تبدیلی پرانی رسیدوں کو نہیں بدلتیں۔',
        'بیک اپ فون میں رکھنا محفوظ نہیں؛ اسے کسی اور ڈیوائس پر شیئر کریں۔',
        'پن کبھی سادہ متن میں محفوظ نہیں ہوتا؛ صرف scrypt ویریفائر رکھا جاتا ہے۔',
        'ڈیٹا بیس فائل فون کی اسٹوریج انکرپشن (Android FBE) پر منحصر ہے؛ SQLCipher شامل نہیں۔',
      ]
    : [
        'The app works fully offline. No internet connection or account is required.',
        'Every stock and money change creates an immutable audit entry — nothing is silently overwritten.',
        'Money is stored as integer paisa and quantities as integer micro-units, so totals never drift.',
        'Prices are frozen on each document at transaction time; later price changes never edit old invoices.',
        'A backup kept only on this phone is not safe. Share it to another device or cloud storage.',
        'The PIN is never stored: only a salted scrypt verifier is kept in Keystore-backed storage.',
        'The database file relies on Android file-based encryption; SQLCipher is not included in this build.',
      ];

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.title}>{ur ? 'مدد اور معلومات' : 'Help & about'}</Text>
        <Text style={styles.sub}>{settings?.storeName ?? ''}</Text>
        <Row label="Version" value={VERSION} />
        <Row label="Schema" value={String(LATEST_SCHEMA_VERSION)} />
        <Row label="Database" value={db?.location ?? '—'} />
      </Card>

      <Section title={ur ? 'اہم باتیں' : 'How this app behaves'}>
        <Card>
          {points.map((point, index) => (
            <Text key={index} style={styles.point}>
              • {point}
            </Text>
          ))}
        </Card>
      </Section>

      <Section title={ur ? 'بارکوڈ اسکینر' : 'Barcode scanner'}>
        <Card>
          <Text style={styles.point}>
            {ur
              ? 'کوئی بھی USB یا بلوٹوتھ بارکوڈ اسکینر (کی بورڈ موڈ) استعمال کریں: اسکینر کوڈ ٹائپ کر کے انٹر دباتا ہے، جو تلاش میں خود بخود مصنوعات شامل کر دیتا ہے۔'
              : 'Any USB/Bluetooth barcode scanner in keyboard mode works: it types the code and presses Enter, which adds the product to the cart from the POS search box.'}
          </Text>
        </Card>
      </Section>

      <Section title={ur ? 'حدود' : 'Known limitations'}>
        <Card>
          <Text style={styles.point}>
            {ur
              ? 'ایک وقت میں ایک ڈیوائس؛ متعدد ڈیوائسز کی ہم آہنگی (sync) شامل نہیں۔'
              : 'Single device only — there is no multi-device synchronisation or conflict resolution.'}
          </Text>
          <Text style={styles.point}>
            {ur
              ? 'ایکسپائر/بیچ ریکارڈنگ ابھی شامل نہیں (فیلڈ موجود ہے مگر مکمل ورک فلو نہیں)۔'
              : 'Batch / expiry workflow is not implemented yet (the flag exists on products, tracking is not wired).'}
          </Text>
          <Text style={styles.point}>
            {ur
              ? 'FTS5 فل ٹیکسٹ سرچ استعمال نہیں؛ تلاش نارملائزڈ انڈیکس پر ہے۔'
              : 'Full-text search uses a normalized indexed column, not SQLite FTS5.'}
          </Text>
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.sm },
  point: { fontSize: font.sm, color: colors.text, marginBottom: spacing.sm, lineHeight: 20 },
});
