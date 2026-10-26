import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Screen, Section } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { listReports, type ReportGroup } from '../../services/reportService';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const GROUP_LABEL: Record<ReportGroup, { en: string; ur: string }> = {
  sales: { en: 'Sales', ur: 'فروخت' },
  purchases: { en: 'Purchases', ur: 'خریداری' },
  inventory: { en: 'Inventory', ur: 'اسٹاک' },
  financial: { en: 'Financial', ur: 'مالیات' },
};

export default function ReportsScreen() {
  const navigation = useNavigation<Nav>();
  const { lang } = useI18n();
  const reports = listReports();
  const groups: ReportGroup[] = ['sales', 'purchases', 'inventory', 'financial'];

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.title}>{lang === 'ur' ? 'رپورٹس' : 'Reports'}</Text>
        <Text style={styles.sub}>
          {lang === 'ur'
            ? 'تمام رپورٹس اصل دستاویزات سے بنتی ہیں اور CSV میں برآمد ہو سکتی ہیں'
            : 'All reports are computed from posted documents and can be exported to CSV'}
        </Text>
      </Card>
      {groups.map(group => (
        <Section key={group} title={GROUP_LABEL[group][lang]}>
          {reports
            .filter(r => r.group === group)
            .map(report => (
              <Pressable
                key={report.id}
                style={styles.row}
                onPress={() => navigation.navigate('ReportView', { reportId: report.id })}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{lang === 'ur' ? report.titleUr : report.titleEn}</Text>
                  <Text style={styles.sub}>{report.columns.length} columns</Text>
                </View>
                <Text style={{ color: colors.primary }}>›</Text>
              </Pressable>
            ))}
        </Section>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted },
  itemTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
