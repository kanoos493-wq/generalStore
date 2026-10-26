import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, Card, ErrorView, Field, LoadingView, ModalSheet, Row, Screen, Section, SelectField } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useActor, useAppStore, useDb } from '../store/appStore';
import { saleDetail, voidSale } from '../../services/salesService';
import { createSaleReturn } from '../../services/returnService';
import { paymentMethods } from '../../services/paymentService';
import { buildReceipt } from '../../services/receiptService';
import { printerBridge } from '../../native/bridge';
import { formatQty, parseQty, QTY_SCALE } from '../../core/money';
import { messageOf } from '../../core/errors';
import { can } from '../../core/permissions';
import type { RootStackParamList } from '../navigationTypes';
import type { SaleLineRow } from '../../db/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SaleDetail'>;

export default function SaleDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const actor = useActor();
  const settings = useAppStore(s => s.settings);
  const { t } = useI18n();
  const f = useFormat();
  const { saleId } = route.params;
  const state = useAsync(() => saleDetail(db, saleId), [saleId]);
  const [methods, setMethods] = useState<{ id: string; label: string }[]>([]);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptText, setReceiptText] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnDamage, setReturnDamage] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      const list = await paymentMethods(db);
      setMethods(list.filter(m => !m.is_credit).map(m => ({ id: m.id, label: m.name_en })));
    })();
  }, [db]);

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}
  if (!state.data) {return <LoadingView />;}
  const { sale, lines, payments, returns } = state.data;

  const buildAndShow = async (duplicate: boolean) => {
    const text = buildReceipt({
      sale,
      lines,
      payments: (payments as unknown as { method_id: string; amount_paisa: number }[]).map(p => ({
        methodName: methods.find(m => m.id === p.method_id)?.label ?? '',
        amountPaisa: Number(p.amount_paisa),
      })),
      store: {
        nameEn: settings?.storeName ?? '',
        nameUr: settings?.storeNameUr ?? '',
        address: settings?.address ?? '',
        phone: settings?.phone ?? '',
        footer: settings?.receiptFooter ?? '',
        terms: settings?.receiptTerms ?? '',
        returnPolicy: settings?.returnPolicy ?? '',
      },
      cashier: sale.created_by,
      duplicate,
      language: settings?.receiptLanguage ?? 'en',
    });
    setReceiptText(text);
    setShowReceipt(true);
  };

  const submitReturn = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = lines
        .map(line => ({
          saleLineId: line.id,
          qtyMicro: parseQty(returnQty[line.id] || '0'),
          damageQtyMicro: parseQty(returnDamage[line.id] || '0'),
        }))
        .filter(item => item.qtyMicro > 0);
      if (!items.length) {throw new Error(`${t('returnItems')} — ${t('required')}`);}
      await createSaleReturn(db, {
        saleId,
        lines: items,
        refundMethodId: refundMethod || null,
        reason: reason || 'Return',
        actor,
      });
      setReturnOpen(false);
      setReturnQty({});
      setReturnDamage({});
      setReason('');
      await state.reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmVoid = () => {
    Alert.alert(t('confirm'), `${t('delete')} ${sale.invoice_no}?`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await voidSale(db, { saleId, reason: 'Voided by manager', actor });
            await state.reload();
          } catch (e) {
            Alert.alert(t('error'), messageOf(e));
          }
        },
      },
    ]);
  };

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.title}>{sale.invoice_no}</Text>
          <Badge
            text={sale.status}
            tone={sale.status === 'posted' ? (Number(sale.credit_paisa) > 0 ? 'warning' : 'success') : 'danger'}
          />
        </View>
        <Text style={styles.sub}>
          {f.dateTime(sale.sold_at)} · {sale.created_by ?? '—'}
        </Text>
        <Text style={styles.sub}>{sale.customer_name ?? t('walkIn')}</Text>
        <View style={{ height: spacing.sm }} />
        <Row label={t('subtotal')} value={f.moneyPlain(Number(sale.subtotal_paisa))} />
        <Row label={t('discount')} value={f.moneyPlain(Number(sale.discount_paisa))} />
        {Number(sale.tax_paisa) > 0 ? <Row label={t('tax')} value={f.moneyPlain(Number(sale.tax_paisa))} /> : null}
        <Row label={t('total')} value={f.money(Number(sale.total_paisa))} bold />
        <Row label={t('paid')} value={f.moneyPlain(Number(sale.paid_paisa))} tone="success" />
        {Number(sale.credit_paisa) > 0 ? (
          <Row label={t('credit')} value={f.moneyPlain(Number(sale.credit_paisa))} tone="danger" />
        ) : null}
        {sale.reversal_reason ? <Text style={styles.sub}>{sale.reversal_reason}</Text> : null}
      </Card>

      <Section title={t('products')}>
        <Card>
          {lines.map((line: SaleLineRow) => (
            <View key={line.id} style={{ marginBottom: spacing.sm }}>
              <Row
                label={line.product_name}
                value={f.moneyPlain(Number(line.line_total_paisa) - Number(line.line_discount_paisa))}
              />
              <Text style={styles.sub}>
                {f.qty(Number(line.qty_micro), line.unit_code)} × {f.moneyPlain(Number(line.unit_price_paisa))}
                {Number(line.returned_qty_micro) > 0
                  ? ` · ${t('returns')}: ${formatQty(Number(line.returned_qty_micro), 3)}`
                  : ''}
              </Text>
            </View>
          ))}
        </Card>
      </Section>

      <Section title={t('payments')}>
        <Card>
          {(payments as unknown as { id: string; method_id: string; amount_paisa: number; paid_at: string }[]).map(p => (
            <Row
              key={p.id}
              label={`${methods.find(m => m.id === p.method_id)?.label ?? p.method_id} · ${f.date(p.paid_at)}`}
              value={f.moneyPlain(Number(p.amount_paisa))}
            />
          ))}
          {payments.length === 0 ? <Text style={styles.sub}>{t('empty')}</Text> : null}
        </Card>
      </Section>

      {returns.length > 0 ? (
        <Section title={t('returns')}>
          <Card>
            {(returns as unknown as { id: string; doc_no: string; total_paisa: number; returned_at: string }[]).map(r => (
              <Row key={r.id} label={`${r.doc_no} · ${f.date(r.returned_at)}`} value={f.moneyPlain(Number(r.total_paisa))} tone="danger" />
            ))}
          </Card>
        </Section>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Button title={t('reprint')} variant="secondary" onPress={() => buildAndShow(true)} />
        {sale.status === 'posted' && can(actor.role, 'sale.return') ? (
          <Button title={t('returnItems')} variant="secondary" onPress={() => setReturnOpen(true)} />
        ) : null}
        {sale.status === 'posted' && can(actor.role, 'settings.manage') ? (
          <Button title={`${t('delete')} / void`} variant="danger" onPress={confirmVoid} />
        ) : null}
      </View>

      <ModalSheet
        visible={showReceipt}
        onClose={() => setShowReceipt(false)}
        title={t('receipt')}
        footer={
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              title={t('print')}
              style={{ flex: 1 }}
              onPress={async () => {
                const printer = printerBridge();
                if (!printer) {return;}
                try {
                  const address = settings?.toMap().printer_address ?? '';
                  if (address) {await printer.printBluetooth(address, receiptText);}
                  else {await printer.printText(receiptText, (settings?.receiptFontSize ?? 10) * 2, sale.invoice_no);}
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            />
            <Button title={t('close')} variant="secondary" style={{ flex: 1 }} onPress={() => setShowReceipt(false)} />
          </View>
        }>
        <View style={styles.receipt}>
          <Text style={styles.receiptText}>{receiptText}</Text>
        </View>
      </ModalSheet>

      <ModalSheet
        visible={returnOpen}
        onClose={() => setReturnOpen(false)}
        title={`${t('returnItems')} · ${sale.invoice_no}`}
        footer={<Button title={busy ? t('saving') : t('save')} onPress={submitReturn} loading={busy} />}>
        {lines.map(line => {
          const available = Number(line.qty_micro) - Number(line.returned_qty_micro);
          return (
            <Card key={line.id}>
              <Text style={styles.title}>{line.product_name}</Text>
              <Text style={styles.sub}>
                {t('soldProducts')}: {f.qty(Number(line.qty_micro), line.unit_code)} · {t('quantity')} {line.unit_code}
              </Text>
              <Field
                label={`${t('returnItems')} (${line.unit_code}) max ${formatQty(available, 3)}`}
                value={returnQty[line.id] ?? ''}
                onChangeText={v => setReturnQty(prev => ({ ...prev, [line.id]: v }))}
                keyboardType="decimal-pad"
              />
              <Field
                label={`${t('damaged')} (${line.unit_code})`}
                value={returnDamage[line.id] ?? ''}
                onChangeText={v => setReturnDamage(prev => ({ ...prev, [line.id]: v }))}
                keyboardType="decimal-pad"
              />
            </Card>
          );
        })}
        <SelectField
          label={t('refund')}
          value={refundMethod}
          options={[{ value: '', label: t('creditNote') }, ...methods.map(m => ({ value: m.id, label: m.name_en }))]}
          onChange={setRefundMethod}
        />
        <Field label={t('reason')} value={reason} onChangeText={setReason} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.sm },
  receipt: { backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  receiptText: { fontFamily: 'monospace', fontSize: 11, color: '#111' },
});
