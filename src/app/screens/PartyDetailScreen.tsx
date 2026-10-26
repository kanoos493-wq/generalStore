import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, Card, ErrorView, Field, LoadingView, ModalSheet, Row, Screen, SelectField, TabPills } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useActor, useDb } from '../store/appStore';
import { partyDetail, partyStatement } from '../../services/partyService';
import { paySupplier, paymentMethods, receiveCustomerPayment } from '../../services/paymentService';
import { parseMoney } from '../../core/money';
import { messageOf } from '../../core/errors';
import { can } from '../../core/permissions';
import { rangeForPreset } from '../../core/dates';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'PartyDetail'>;
type Tab = 'overview' | 'khata' | 'payments' | 'docs';

export default function PartyDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const actor = useActor();
  const { t } = useI18n();
  const f = useFormat();
  const { partyType, partyId } = route.params;
  const [tab, setTab] = useState<Tab>('overview');
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('pm_cash');
  const [methods, setMethods] = useState<{ value: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = useAsync(async () => {
    const detail = await partyDetail(db, partyType, partyId);
    const statement = await partyStatement(db, partyType, partyId, rangeForPreset('month'));
    const list = await paymentMethods(db);
    return { detail, statement, methods: list.filter(m => !m.is_credit) };
  }, [partyType, partyId, tab]);

  React.useEffect(() => {
    if (!state.data) {return;}
    setMethods(state.data.methods.map(m => ({ value: m.id, label: m.name_en })));
  }, [state.data]);

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}
  if (!state.data) {return <LoadingView />;}
  const { detail, statement } = state.data;
  const { party, ledger, payments, docs, totals } = detail;
  const balance = Number(party.balance_paisa);
  const canPay = can(actor.role, 'payment.record');

  const submitPayment = async () => {
    setBusy(true);
    setError(null);
    try {
      const amountPaisa = parseMoney(amount || '0');
      if (partyType === 'customer') {
        await receiveCustomerPayment(db, { customerId: partyId, amountPaisa, methodId, actor });
      } else {
        await paySupplier(db, { supplierId: partyId, amountPaisa, methodId, actor });
      }
      setPayOpen(false);
      setAmount('');
      await state.reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{party.name_en}</Text>
            {party.name_ur ? <Text style={styles.urdu}>{party.name_ur}</Text> : null}
            <Text style={styles.sub}>{party.phone ?? '—'}</Text>
            {party.address ? <Text style={styles.sub}>{party.address}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.balance, { color: balance > 0 ? colors.danger : colors.success }]}>
              {f.moneyPlain(Math.abs(balance))}
            </Text>
            <Badge
              text={
                balance > 0
                  ? partyType === 'customer'
                    ? t('owes')
                    : t('youOwe')
                  : balance < 0
                    ? t('credit')
                    : t('none')
              }
              tone={balance > 0 ? 'warning' : 'success'}
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          {canPay ? (
            <Button title={partyType === 'customer' ? t('receivePayment') : t('paySupplier')} onPress={() => setPayOpen(true)} style={{ flex: 1 }} />
          ) : null}
          <Button
            title={t('edit')}
            variant="secondary"
            onPress={() => navigation.navigate('PartyForm', { partyType, partyId })}
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      <TabPills
        tabs={[
          { value: 'overview', label: t('settings') },
          { value: 'khata', label: t('khata') },
          { value: 'payments', label: t('payments') },
          { value: 'docs', label: partyType === 'customer' ? t('invoices') : t('purchases') },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' ? (
        <Card>
          <Row label={t('openingBalance')} value={f.moneyPlain(Number(party.opening_balance_paisa))} />
          <Row label={t('balance')} value={f.moneyPlain(balance)} bold />
          {partyType === 'customer' && party.credit_limit_paisa ? (
            <Row label={t('creditLimit')} value={f.moneyPlain(Number(party.credit_limit_paisa))} />
          ) : null}
          <Row label={t('creditDays')} value={String(party.credit_days)} />
          <Row label={t('total')} value={f.moneyPlain(Number(totals?.total ?? 0))} />
          <Row label={partyType === 'customer' ? t('invoices') : t('purchases')} value={String(totals?.count ?? 0)} />
        </Card>
      ) : null}

      {tab === 'khata' ? (
        <>
          <Card>
            <Row label={`${t('openingBalance')} (${f.date(statement.openingBalancePaisa === 0 ? new Date().toISOString() : new Date().toISOString())})`} value={f.moneyPlain(statement.openingBalancePaisa)} />
            {statement.entries.length === 0 ? <Text style={styles.sub}>{t('empty')}</Text> : null}
            {(statement.entries as unknown as { id: string; entry_at: string; description: string; debit_paisa: number; credit_paisa: number; balance_paisa: number }[]).map(entry => (
              <View key={entry.id} style={styles.ledgerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.ledgerTitle}>{entry.description}</Text>
                  <Text style={styles.sub}>{f.dateTime(entry.entry_at)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.ledgerAmount}>
                    {Number(entry.debit_paisa) > 0 ? `+${f.moneyPlain(Number(entry.debit_paisa))}` : `-${f.moneyPlain(Number(entry.credit_paisa))}`}
                  </Text>
                  <Text style={styles.sub}>{f.moneyPlain(Number(entry.balance_paisa))}</Text>
                </View>
              </View>
            ))}
            <Row label={t('runningBalance')} value={f.moneyPlain(statement.closingBalancePaisa)} bold />
          </Card>
          <Card>
            <Row label={t('ledger')} value={`${ledger.length} ${t('ledger')}`} />
          </Card>
        </>
      ) : null}

      {tab === 'payments' ? (
        <Card>
          {(payments as unknown as { id: string; amount_paisa: number; paid_at: string; method_id: string; direction: string }[]).map(p => (
            <Row
              key={p.id}
              label={`${f.dateTime(p.paid_at)} · ${methods.find(m => m.value === p.method_id)?.label ?? p.method_id}`}
              value={`${p.direction === 'in' ? '+' : '-'}${f.moneyPlain(Number(p.amount_paisa))}`}
              tone={p.direction === 'in' ? 'success' : 'default'}
            />
          ))}
          {payments.length === 0 ? <Text style={styles.sub}>{t('empty')}</Text> : null}
        </Card>
      ) : null}

      {tab === 'docs' ? (
        <Card>
          {(docs as unknown as Record<string, string | number | null>[]).map(doc => {
            const id = String(doc.id);
            const isSale = partyType === 'customer';
            return (
              <Pressable
                key={id}
                onPress={() =>
                  isSale
                    ? navigation.navigate('SaleDetail', { saleId: id })
                    : navigation.navigate('PurchaseDetail', { purchaseId: id })
                }>
                <Row
                  label={`${isSale ? doc.invoice_no : doc.doc_no} · ${f.date(String(isSale ? doc.sold_at : doc.purchased_at))}`}
                  value={f.moneyPlain(Number(doc.total_paisa))}
                  tone={String(doc.status) === 'posted' ? 'default' : 'danger'}
                />
              </Pressable>
            );
          })}
          {docs.length === 0 ? <Text style={styles.sub}>{t('empty')}</Text> : null}
        </Card>
      ) : null}

      <ModalSheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        title={partyType === 'customer' ? t('receivePayment') : t('paySupplier')}
        footer={<Button title={busy ? t('saving') : t('save')} onPress={submitPayment} loading={busy} />}>
        <Card>
          <Row label={t('balance')} value={f.moneyPlain(balance)} bold />
        </Card>
        <Field label={t('amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <SelectField label={t('paymentMethod')} value={methodId} options={methods} onChange={setMethodId} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  urdu: { fontSize: font.md, color: colors.muted },
  sub: { fontSize: font.xs, color: colors.muted },
  balance: { fontSize: font.lg, fontWeight: '800' },
  ledgerRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  ledgerTitle: { fontSize: font.sm, color: colors.text, fontWeight: '600' },
  ledgerAmount: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.sm },
});
