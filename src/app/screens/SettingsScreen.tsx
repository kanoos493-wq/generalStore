import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Field, Row, Screen, Section, SelectField } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useAppStore, useSettings } from '../store/appStore';
import { messageOf } from '../../core/errors';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { t, lang } = useI18n();
  const settings = useSettings();
  const saveSettings = useAppStore(s => s.saveSettings);
  const setLanguage = useAppStore(s => s.setLanguage);
  const map = settings.toMap();

  const [storeName, setStoreName] = useState(settings.storeName);
  const [storeNameUr, setStoreNameUr] = useState(settings.storeNameUr);
  const [address, setAddress] = useState(settings.address);
  const [phone, setPhone] = useState(settings.phone);
  const [whatsapp, setWhatsapp] = useState(settings.whatsapp);
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix);
  const [footer, setFooter] = useState(settings.receiptFooter);
  const [terms, setTerms] = useState(settings.receiptTerms);
  const [returnPolicy, setReturnPolicy] = useState(settings.returnPolicy);
  const [rounding, setRounding] = useState(settings.priceRounding);
  const [qtyPrecision, setQtyPrecision] = useState(String(settings.qtyPrecision));
  const [discountLimit, setDiscountLimit] = useState(String(settings.discountLimitBp / 100));
  const [negativeStock, setNegativeStock] = useState(settings.allowNegativeStock);
  const [fontSize, setFontSize] = useState(String(settings.receiptFontSize));
  const [printerAddress, setPrinterAddress] = useState(map.printer_address ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await saveSettings({
        store_name: storeName,
        store_name_ur: storeNameUr,
        store_address: address,
        store_phone: phone,
        store_whatsapp: whatsapp,
        invoice_prefix: invoicePrefix,
        receipt_footer: footer,
        receipt_terms: terms,
        return_policy: returnPolicy,
        price_rounding: rounding,
        qty_precision: qtyPrecision,
        discount_limit_bp: String(Math.round(parseFloat(discountLimit || '0') * 100)),
        allow_negative_stock: negativeStock ? '1' : '0',
        receipt_font_size: fontSize,
        printer_address: printerAddress,
      });
      setMessage(t('save'));
    } catch (e) {
      setMessage(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Section title={t('storeProfile')}>
        <Card>
          <Field label={t('storeName')} value={storeName} onChangeText={setStoreName} />
          <Field label={t('nameUr')} value={storeNameUr} onChangeText={setStoreNameUr} />
          <Field label={t('address')} value={address} onChangeText={setAddress} multiline />
          <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="WhatsApp" value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" />
          <Field label="Invoice prefix" value={invoicePrefix} onChangeText={setInvoicePrefix} />
          <SelectField
            label={t('language')}
            value={lang}
            options={[
              { value: 'en', label: t('english') },
              { value: 'ur', label: t('urdu') },
            ]}
            onChange={value => void setLanguage(value as 'en' | 'ur')}
          />
          <Text style={styles.hint}>
            {lang === 'ur' ? 'زبان بدلنے پر اگلی بار ایپ دائیں سے بائیں کھلے گی' : 'Layout direction switches to RTL on next launch after choosing Urdu.'}
          </Text>
        </Card>
      </Section>

      <Section title={t('pricing')}>
        <Card>
          <SelectField
            label={t('priceRounding')}
            value={rounding}
            options={[
              { value: 'paisa', label: 'Paisa (exact)' },
              { value: 'rupee', label: 'Nearest rupee' },
              { value: 'five_rupees', label: 'Nearest 5 rupees' },
            ]}
            onChange={v => setRounding(v as 'paisa' | 'rupee' | 'five_rupees')}
          />
          <Field label="Quantity decimals" value={qtyPrecision} onChangeText={setQtyPrecision} keyboardType="number-pad" />
          <Field label={t('discountLimit')} value={discountLimit} onChangeText={setDiscountLimit} keyboardType="decimal-pad" />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('allowNegativeStock')}</Text>
            <Switch value={negativeStock} onValueChange={setNegativeStock} trackColor={{ true: colors.primary }} />
          </View>
          <Row label={t('valuationMethod')} value={settings.valuationMethod === 'latest' ? 'Latest cost' : t('weightedAverage')} />
        </Card>
      </Section>

      <Section title={t('receiptSettings')}>
        <Card>
          <Field label={t('receiptFooter')} value={footer} onChangeText={setFooter} multiline />
          <Field label={t('receiptTerms')} value={terms} onChangeText={setTerms} multiline />
          <Field label={t('returnPolicy')} value={returnPolicy} onChangeText={setReturnPolicy} multiline />
          <Field label={t('fontSize')} value={fontSize} onChangeText={setFontSize} keyboardType="number-pad" />
          <Field
            label="Bluetooth printer MAC"
            value={printerAddress}
            onChangeText={setPrinterAddress}
            hint={lang === 'ur' ? 'خالی چھوڑیں تو اینڈرائیڈ پرنٹ سروس استعمال ہوگی' : 'Leave empty to use the Android print service (PDF / print dialog)'}
          />
        </Card>
      </Section>

      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Button title={busy ? t('saving') : t('save')} onPress={save} loading={busy} />

      <Section title={t('security')}>
        <ClickRow label={t('security')} onPress={() => navigation.navigate('Security')} />
        <ClickRow label={t('backup')} onPress={() => navigation.navigate('Backup')} />
        <ClickRow label={t('reports')} onPress={() => navigation.navigate('Reports')} />
        <ClickRow label={t('help')} onPress={() => navigation.navigate('Help')} />
      </Section>
    </Screen>
  );
}

function ClickRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.clickRow} onPress={onPress}>
      <Text style={styles.clickText}>{label}</Text>
      <Text style={{ color: colors.muted }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: font.xs, color: colors.faint, marginTop: spacing.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  switchLabel: { fontSize: font.sm, color: colors.text, flex: 1 },
  message: { color: colors.success, fontWeight: '600', marginBottom: spacing.md },
  clickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: 10,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  clickText: { fontSize: font.md, color: colors.text, fontWeight: '600' },
});
