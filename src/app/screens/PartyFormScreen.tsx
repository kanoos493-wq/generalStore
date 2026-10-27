import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Field, Screen } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useActor, useDb } from '../store/appStore';
import { createParty, updateParty } from '../../services/partyService';
import { parseMoney } from '../../core/money';
import { messageOf } from '../../core/errors';
import { showToast } from '../toast';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'PartyForm'>;

export default function PartyFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const actor = useActor();
  const { t } = useI18n();
  const { partyType, partyId } = route.params;

  const [nameEn, setNameEn] = useState('');
  const [nameUr, setNameUr] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [opening, setOpening] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [creditDays, setCreditDays] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!partyId) {return;}
    void (async () => {
      const table = partyType === 'customer' ? 'customers' : 'suppliers';
      const row = await db.one<Record<string, string | number | null>>(`SELECT * FROM ${table} WHERE id = ?`, [partyId]);
      if (!row) {return;}
      setNameEn(String(row.name_en ?? ''));
      setNameUr(String(row.name_ur ?? ''));
      setPhone(String(row.phone ?? ''));
      setWhatsapp(String(row.whatsapp ?? ''));
      setAddress(String(row.address ?? ''));
      setContactPerson(String(row.contact_person ?? ''));
      setCreditLimit(row.credit_limit_paisa ? String(Number(row.credit_limit_paisa) / 100) : '');
      setCreditDays(String(row.credit_days ?? 0));
      setNotes(String(row.notes ?? ''));
    })();
  }, [db, partyId, partyType]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!nameEn.trim()) {throw new Error(`${t('name')} — ${t('required')}`);}
      const input = {
        nameEn,
        nameUr: nameUr || null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        address: address || null,
        contactPerson: contactPerson || null,
        creditLimitPaisa: creditLimit ? parseMoney(creditLimit) : 0,
        creditDays: parseInt(creditDays, 10) || 0,
        notes: notes || null,
      };
      if (partyId) {
        await updateParty(db, partyType, { ...input, id: partyId }, actor);
        showToast(t('toastUpdated'));
        navigation.goBack();
      } else {
        const id = await createParty(
          db,
          partyType,
          { ...input, openingBalancePaisa: opening ? parseMoney(opening) : 0 },
          actor,
        );
        showToast(t('toastAdded'));
        navigation.replace('PartyDetail', { partyType, partyId: id });
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Card>
        <Field label={t('nameEn')} value={nameEn} onChangeText={setNameEn} />
        <Field label={t('nameUr')} value={nameUr} onChangeText={setNameUr} />
        <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label={`WhatsApp (${t('optional')})`} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" />
        <Field label={t('address')} value={address} onChangeText={setAddress} multiline />
        {partyType === 'supplier' ? (
          <Field label={`Contact person (${t('optional')})`} value={contactPerson} onChangeText={setContactPerson} />
        ) : null}
        {!partyId ? (
          <Field
            label={`${t('openingBalance')} (${t('optional')})`}
            value={opening}
            onChangeText={setOpening}
            keyboardType="decimal-pad"
            hint={partyType === 'customer' ? 'positive = customer owes you' : 'positive = you owe the supplier'}
          />
        ) : null}
        {partyType === 'customer' ? (
          <Field label={`${t('creditLimit')} (${t('optional')})`} value={creditLimit} onChangeText={setCreditLimit} keyboardType="decimal-pad" />
        ) : null}
        <Field label={t('creditDays')} value={creditDays} onChangeText={setCreditDays} keyboardType="number-pad" />
        <Field label={t('notes')} value={notes} onChangeText={setNotes} multiline />
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={busy ? t('saving') : t('save')} onPress={save} loading={busy} />
      <Text style={styles.hint}>
        {t('openingBalance')}: {t('khata')} — every change is a ledger entry, never a manual balance edit.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.md },
  hint: { fontSize: font.xs, color: colors.faint, marginTop: spacing.md },
});
