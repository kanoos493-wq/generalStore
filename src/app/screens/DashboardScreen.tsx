import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bars, Card, ErrorView, Kpi, LoadingView, Pill, Row, Screen, Section } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useAppStore, useDb } from '../store/appStore';
import { loadDashboard } from '../../services/dashboardService';
import { rangeForPreset, type DateRange } from '../../core/dates';
import type { RootStackParamList } from '../navigationTypes';
import { backupDue } from '../../services/backupService';
import { backupHistory } from '../../services/backupService';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Preset = 'today' | 'yesterday' | 'week' | 'month';

export default function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const { t, lang } = useI18n();
  const f = useFormat();
  const settings = useAppStore(s => s.settings);
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('today'));

  const state = useAsync(async () => {
    const dash = await loadDashboard(db, range);
    const backups = await backupHistory(db);
    return { dash, backups };
  }, [range.from, range.to]);

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}
  if (!state.data) {return <LoadingView />;}
  const { dash, backups } = state.data;
  const due = backupDue(backups[0] ?? null, settings?.backupReminderDays ?? 7);

  const quickActions: { label: string; onPress: () => void }[] = [
    { label: t('newSale'), onPress: () => navigation.navigate('Tabs') },
    { label: t('addProduct'), onPress: () => navigation.navigate('ProductForm') },
    { label: t('newPurchase'), onPress: () => navigation.navigate('PurchaseForm') },
    { label: t('addCustomer'), onPress: () => navigation.navigate('PartyForm', { partyType: 'customer' }) },
    { label: t('addSupplier'), onPress: () => navigation.navigate('PartyForm', { partyType: 'supplier' }) },
    { label: t('addExpense'), onPress: () => navigation.navigate('Expenses') },
    { label: t('stockAdjust'), onPress: () => navigation.navigate('AdjustmentForm') },
    { label: t('cashClosing'), onPress: () => navigation.navigate('CashClosing') },
  ];

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {(
          [
            ['today', t('today')],
            ['yesterday', t('yesterday')],
            ['week', t('thisWeek')],
            ['month', t('thisMonth')],
          ] as [Preset, string][]
        ).map(([value, label]) => (
          <Pill
            key={value}
            label={label}
            selected={preset === value}
            onPress={() => {
              setPreset(value);
              setRange(rangeForPreset(value));
            }}
          />
        ))}
      </ScrollView>

      {due ? (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
          <Pressable onPress={() => navigation.navigate('Backup')}>
            <Text style={{ color: colors.warning, fontWeight: '700' }}>{t('lastBackup')}: —</Text>
            <Text style={{ color: colors.warning, fontSize: font.sm }}>{t('backupCaution')}</Text>
          </Pressable>
        </Card>
      ) : null}

      <View style={styles.kpiGrid}>
        <Kpi label={t('grossSales')} value={f.moneyPlain(dash.sales.grossSalesPaisa)} sub={`${dash.sales.billCount} ${t('invoices')}`} />
        <Kpi label={t('netSales')} value={f.moneyPlain(dash.sales.netSalesPaisa)} tone="success" />
        <Kpi label={t('cashReceived')} value={f.moneyPlain(dash.cashPaymentsPaisa)} />
        <Kpi label={t('digitalReceived')} value={f.moneyPlain(dash.digitalPaymentsPaisa)} />
        <Kpi label={t('creditSales')} value={f.moneyPlain(dash.sales.creditPaisa)} tone="warning" />
        <Kpi label={t('receivables')} value={f.moneyPlain(dash.receivablesPaisa)} tone="danger" />
        <Kpi label={t('payables')} value={f.moneyPlain(dash.payablesPaisa)} />
        <Kpi label={t('purchases')} value={f.moneyPlain(dash.purchasesPaisa)} />
        <Kpi label={t('expenses')} value={f.moneyPlain(dash.profit.expensesPaisa)} />
        <Kpi label={t('grossProfit')} value={f.moneyPlain(dash.profit.grossProfitPaisa)} tone="success" />
        <Kpi label={t('netProfit')} value={f.moneyPlain(dash.profit.operatingProfitPaisa)} sub="excl. drawings" />
        <Kpi label={t('stockValue')} value={f.moneyPlain(dash.stockValuePaisa)} sub={`${dash.stockItemCount} ${t('stockItems')}`} />
        <Kpi label={t('lowStock')} value={String(dash.lowStockCount)} tone="warning" />
        <Kpi label={t('outOfStock')} value={String(dash.outOfStockCount)} tone="danger" />
        <Kpi label={t('expectedCash')} value={f.moneyPlain(dash.cash.expectedPaisa)} sub={dash.cash.shiftId ? 'shift open' : 'no open shift'} />
        <Kpi
          label={t('lastClosing')}
          value={dash.lastClosing ? f.moneyPlain(dash.lastClosing.differencePaisa) : '—'}
          sub={dash.lastClosing ? f.date(dash.lastClosing.closedAt) : undefined}
          tone={dash.lastClosing && dash.lastClosing.differencePaisa !== 0 ? 'warning' : 'default'}
        />
      </View>

      <Section title={t('quickActions')}>
        <View style={styles.actions}>
          {quickActions.map(action => (
            <Pressable key={action.label} onPress={action.onPress} style={styles.action}>
              <Text style={styles.actionText}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title={t('topProducts')}>
        <Card>
          {dash.topProducts.length === 0 ? (
            <Text style={styles.muted}>{t('empty')}</Text>
          ) : (
            dash.topProducts.map(p => (
              <Row
                key={p.productName}
                label={p.productName}
                value={`${f.qty(p.qtyMicro, p.unit)} · ${f.moneyPlain(p.salesPaisa)}`}
              />
            ))
          )}
        </Card>
      </Section>

      {dash.trend.length > 0 ? (
        <Section title={t('grossSales')}>
          <Card>
            <Bars
              data={dash.trend.slice(-7).map(d => ({ label: d.day.slice(5), value: d.salesPaisa }))}
              format={v => f.moneyPlain(v)}
            />
          </Card>
        </Section>
      ) : null}

      <Section
        title={t('alerts')}
        action={
          <Pressable onPress={() => navigation.navigate('Restock')}>
            <Text style={styles.link}>{t('restock')}</Text>
          </Pressable>
        }>
        <Card>
          {dash.lowStock.length === 0 ? (
            <Text style={styles.muted}>{t('empty')}</Text>
          ) : (
            dash.lowStock.map(item => (
              <Row
                key={String(item.id)}
                label={String(item.name_en)}
                value={f.qty(Number(item.stock_micro), String(item.base_unit))}
                tone="danger"
              />
            ))
          )}
        </Card>
      </Section>

      <Section
        title={t('recentSales')}
        action={
          <Pressable onPress={() => navigation.navigate('SalesHistory')}>
            <Text style={styles.link}>{t('all')}</Text>
          </Pressable>
        }>
        <Card>
          {dash.recentSales.map(sale => (
            <Pressable
              key={String(sale.id)}
              onPress={() => navigation.navigate('SaleDetail', { saleId: String(sale.id) })}>
              <Row
                label={`${sale.invoice_no}`}
                value={f.moneyPlain(Number(sale.total_paisa))}
                tone={String(sale.status) === 'reversed' ? 'danger' : 'default'}
              />
              <Text style={styles.muted}>
                {String(sale.customer_name ?? t('walkIn'))} · {f.time(String(sale.sold_at))}
              </Text>
            </Pressable>
          ))}
          {dash.recentSales.length === 0 ? <Text style={styles.muted}>{t('empty')}</Text> : null}
        </Card>
      </Section>

      <Section title={t('expenses')}>
        <Card>
          {dash.recentExpenses.map(exp => (
            <Row
              key={String(exp.id)}
              label={`${exp.description}`}
              value={f.moneyPlain(Number(exp.amount_paisa))}
            />
          ))}
          {dash.recentExpenses.length === 0 ? <Text style={styles.muted}>{t('empty')}</Text> : null}
        </Card>
      </Section>

      <Text style={styles.footer}>
        {lang === 'ur'
          ? 'تمام اعداد اصل دستاویزات سے آتے ہیں'
          : 'All figures come from posted documents (see ACCOUNTING_RULES.md)'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  pills: { gap: spacing.sm, paddingBottom: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minWidth: '45%',
    alignItems: 'center',
  },
  actionText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  muted: { fontSize: font.sm, color: colors.muted },
  link: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
  footer: { fontSize: font.xs, color: colors.faint, textAlign: 'center', marginBottom: spacing.lg },
});
