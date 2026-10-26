import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Screen, Section, SelectField } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useAppStore } from '../store/appStore';
import { ROLE_LABELS, type Role } from '../../core/permissions';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function MoreScreen() {
  const navigation = useNavigation<Nav>();
  const { t, lang } = useI18n();
  const actor = useAppStore(s => s.actor);
  const setRole = useAppStore(s => s.setRole);
  const setLanguage = useAppStore(s => s.setLanguage);

  const items: { label: string; onPress: () => void }[] = [
    { label: t('purchases'), onPress: () => navigation.navigate('PurchasesHistory') },
    { label: t('recentSales'), onPress: () => navigation.navigate('SalesHistory') },
    { label: t('returns'), onPress: () => navigation.navigate('Returns') },
    { label: t('supplier'), onPress: () => navigation.navigate('PartyList', { partyType: 'supplier' }) },
    { label: t('customer'), onPress: () => navigation.navigate('PartyList', { partyType: 'customer' }) },
    { label: t('khata'), onPress: () => navigation.navigate('PartyList', { partyType: 'customer' }) },
    { label: t('stockAdjust'), onPress: () => navigation.navigate('StockAdjustments') },
    { label: t('restock'), onPress: () => navigation.navigate('Restock') },
    { label: t('expenses'), onPress: () => navigation.navigate('Expenses') },
    { label: t('cashClosing'), onPress: () => navigation.navigate('CashClosing') },
    { label: t('reports'), onPress: () => navigation.navigate('Reports') },
    { label: t('backup'), onPress: () => navigation.navigate('Backup') },
    { label: t('settings'), onPress: () => navigation.navigate('Settings') },
    { label: t('help'), onPress: () => navigation.navigate('Help') },
  ];

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.title}>{actor.name}</Text>
        <Text style={styles.sub}>{ROLE_LABELS[actor.role][lang]}</Text>
        <SelectField
          label={t('role')}
          value={actor.role}
          options={(Object.keys(ROLE_LABELS) as Role[]).map(role => ({ value: role, label: ROLE_LABELS[role][lang] }))}
          onChange={value => void setRole(value as Role)}
        />
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
          {lang === 'ur'
            ? 'کردار بدلنے سے اجازتیں بدل جاتی ہیں (سروس کی سطح پر نافذ)'
            : 'Changing the role changes enforced permissions (checked in the service layer, not just the UI)'}
        </Text>
      </Card>

      <Section title={t('more')}>
        <View style={styles.grid}>
          {items.map(item => (
            <Pressable key={item.label} onPress={item.onPress} style={styles.tile}>
              <Text style={styles.tileText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.md },
  hint: { fontSize: font.xs, color: colors.faint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    minWidth: '46%',
    flexGrow: 1,
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: 64,
    justifyContent: 'center',
  },
  tileText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
});
