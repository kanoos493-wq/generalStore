import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { Button, Card, EmptyState, ErrorView, Field, LoadingView, Pill, Screen } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useAppStore, useDb } from '../store/appStore';
import { findReport, reportToCsv, runReport, type ReportRow } from '../../services/reportService';
import { fromDateKey, rangeForPreset, toDateKey, type DateRange } from '../../core/dates';
import { QTY_SCALE } from '../../core/money';
import { NativeBackupTarget, printerBridge } from '../../native/bridge';
import { messageOf } from '../../core/errors';
import type { RootStackParamList } from '../navigationTypes';

type Route = RouteProp<RootStackParamList, 'ReportView'>;
type Preset = 'today' | 'week' | 'month' | 'year' | 'all';

export default function ReportViewScreen() {
  const route = useRoute<Route>();
  const db = useDb();
  const { t, lang } = useI18n();
  const f = useFormat();
  const settings = useAppStore(s => s.settings);
  const report = findReport(route.params.reportId);
  const [preset, setPreset] = useState<Preset>('month');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('month'));
  const [fromKey, setFromKey] = useState(toDateKey(new Date(Date.now() - 30 * 86400000)));
  const [toKey, setToKey] = useState(toDateKey(new Date()));
  const [custom, setCustom] = useState(false);

  const state = useAsync(async () => {
    if (!report) {return [];}
    return runReport(db, report.id, range);
  }, [report?.id, range.from, range.to]);

  if (!report) {return <ErrorView message="Unknown report" />;}

  const formatCell = (value: string | number | null, kind: string): string => {
    if (value === null || value === undefined) {return '—';}
    if (kind === 'money') {return f.moneyPlain(Number(value));}
    if (kind === 'qty') {return (Number(value) / QTY_SCALE).toFixed(3).replace(/\.?0+$/, '');}
    if (kind === 'percent') {return `${(Number(value) / 100).toFixed(1)}%`;}
    if (kind === 'date') {return f.date(String(value));}
    return String(value);
  };

  const exportCsv = async () => {
    try {
      const rows = (state.data ?? []) as ReportRow[];
      const csv = reportToCsv(report, rows, {
        language: lang,
        meta: [
          `${settings?.storeName ?? ''} — ${lang === 'ur' ? report.titleUr : report.titleEn}`,
          `${t('from')} ${f.date(range.from)} ${t('to')} ${f.date(range.to)}`,
        ],
      });
      const target = new NativeBackupTarget();
      const name = `${report.id}-${toDateKey(new Date())}.csv`;
      const path = await target.writeExport(name, csv);
      await target.share(path);
    } catch (e) {
      Alert.alert(t('export'), messageOf(e));
    }
  };

  const printReport = async () => {
    const printer = printerBridge();
    if (!printer) {return;}
    const rows = (state.data ?? []) as ReportRow[];
    const header = report.columns.map(c => (lang === 'ur' ? c.labelUr : c.labelEn)).join(' | ');
    const body = rows
      .slice(0, 200)
      .map(r => report.columns.map(c => formatCell(r[c.key] ?? null, c.kind)).join(' | '))
      .join('\n');
    const text = `${settings?.storeName ?? ''}\n${lang === 'ur' ? report.titleUr : report.titleEn}\n${f.date(range.from)} - ${f.date(range.to)}\n\n${header}\n${'-'.repeat(42)}\n${body}`;
    try {
      const address = settings?.toMap().printer_address ?? '';
      if (address) {await printer.printBluetooth(address, text);}
      else {await printer.printText(text, 18, report.id);}
    } catch (e) {
      Alert.alert(t('print'), messageOf(e));
    }
  };

  const rows = (state.data ?? []) as ReportRow[];

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <Card>
        <Text style={styles.title}>{lang === 'ur' ? report.titleUr : report.titleEn}</Text>
        <Text style={styles.sub}>
          {report.needsRange ? `${f.date(range.from)} → ${f.date(range.to)}` : `${t('all')} · ${f.dateTime(new Date().toISOString())}`}
        </Text>
        {report.needsRange ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {(
              [
                ['today', t('today')],
                ['week', t('thisWeek')],
                ['month', t('thisMonth')],
                ['year', t('thisYear')],
                ['all', t('all')],
              ] as [Preset, string][]
            ).map(([value, label]) => (
              <Pill
                key={value}
                label={label}
                selected={preset === value && !custom}
                onPress={() => {
                  setCustom(false);
                  setPreset(value);
                  setRange(rangeForPreset(value));
                }}
              />
            ))}
            <Pill label={t('custom')} selected={custom} onPress={() => setCustom(true)} />
          </View>
        ) : null}
        {custom ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label={t('from')} value={fromKey} onChangeText={setFromKey} placeholder="2026-10-01" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('to')} value={toKey} onChangeText={setToKey} placeholder="2026-10-31" />
            </View>
            <Button
              title={t('apply')}
              small
              onPress={() =>
                setRange({
                  from: fromDateKey(fromKey).toISOString(),
                  to: new Date(fromDateKey(toKey).getTime() + 86399999).toISOString(),
                })
              }
              style={{ height: 44, marginBottom: spacing.md }}
            />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button title={t('export')} variant="secondary" style={{ flex: 1 }} onPress={exportCsv} />
          <Button title={t('print')} variant="secondary" style={{ flex: 1 }} onPress={printReport} />
        </View>
      </Card>

      {state.loading && !state.data ? (
        <LoadingView />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView horizontal>
          <View>
            <View style={[styles.tableRow, styles.tableHead]}>
              {report.columns.map(c => (
                <Text key={c.key} style={[styles.cell, styles.headCell, c.kind === 'money' || c.kind === 'qty' ? styles.numCell : null]}>
                  {lang === 'ur' ? c.labelUr : c.labelEn}
                </Text>
              ))}
            </View>
            {rows.slice(0, 300).map((row, index) => (
              <View key={index} style={[styles.tableRow, index % 2 === 0 ? null : styles.tableAlt]}>
                {report.columns.map(c => (
                  <Text
                    key={c.key}
                    style={[styles.cell, c.kind === 'money' || c.kind === 'qty' ? styles.numCell : null]}
                    numberOfLines={2}>
                    {formatCell(row[c.key] ?? null, c.kind)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      {rows.length > 300 ? (
        <Text style={styles.sub}>
          Showing 300 of {rows.length} rows — export CSV for the full data set.
        </Text>
      ) : null}
      <Text style={styles.sub}>
        {t('valuationMethod')}: {settings?.valuationMethod === 'latest' ? 'latest cost' : t('weightedAverage')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted, marginTop: spacing.xs },
  tableRow: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tableHead: { backgroundColor: colors.cardAlt },
  tableAlt: { backgroundColor: colors.card },
  cell: { width: 120, fontSize: font.xs, color: colors.text, paddingHorizontal: spacing.sm },
  headCell: { fontWeight: '800', color: colors.muted },
  numCell: { textAlign: 'right' },
});
