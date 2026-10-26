import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, Card, ErrorView, LoadingView, Row, Screen, Section } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useActor, useAppStore, useDb } from '../store/appStore';
import { purchaseDetail, voidPurchase } from '../../services/purchaseService';
import { printerBridge } from '../../native/bridge';
import { formatMoney, formatQty } from '../../core/money';
import { messageOf } from '../../core/errors';
import { can } from '../../core/permissions';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'PurchaseDetail'>;

export default function PurchaseDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const actor = useActor();
  const settings = useAppStore(s => s.settings);
  const { t } = useI18n();
  const f = useFormat();
  const { purchaseId } = route.params;
  const state = useAsync(() => purchaseDetail(db, purchaseId), [purchaseId]);
  const [error, setError] = useState<string | null>(null);

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}
  if (!state.data) {return <LoadingView />;}
  const { purchase, lines, payments } = state.data;

  const asText = () => {
    const w = 42;
    const out: string[] = [];
    out.push(settings?.storeName ?? 'General Store');
    out.push(`PURCHASE ${purchase.doc_no}`);
    out.push(f.dateTime(purchase.purchased_at));
    out.push(`Supplier: ${purchase.supplier_name ?? '-'}`);
    if (purchase.ref_no) {out.push(`Ref: ${purchase.ref_no}`);}
    out.push('-'.repeat(w));
    for (const line of lines as unknown as { product_name: string; qty_micro: number; unit_code: string; unit_cost_paisa: number; line_total_paisa: number }[]) {
      out.push(line.product_name);
      out.push(`  ${formatQty(Number(line.qty_micro), 3)} ${line.unit_code} @ ${formatMoney(Number(line.unit_cost_paisa))} = ${formatMoney(Number(line.line_total_paisa))}`);
    }
    out.push('-'.repeat(w));
    out.push(`Subtotal ${formatMoney(Number(purchase.subtotal_paisa))}`);
    out.push(`Discount ${formatMoney(Number(purchase.discount_paisa))}`);
    out.push(`Freight  ${formatMoney(Number(purchase.freight_paisa))}`);
    out.push(`TOTAL    ${formatMoney(Number(purchase.total_paisa))}`);
    out.push(`Paid     ${formatMoney(Number(purchase.paid_paisa))}`);
    out.push(`Payable  ${formatMoney(Number(purchase.total_paisa) - Number(purchase.paid_paisa))}`);
    return out.join('\n');
  };

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.title}>{purchase.doc_no}</Text>
          <Badge text={purchase.status} tone={purchase.status === 'posted' ? 'success' : 'danger'} />
        </View>
        <Text style={styles.sub}>
          {f.dateTime(purchase.purchased_at)} · {purchase.supplier_name ?? t('none')}
        </Text>
        {purchase.ref_no ? <Text style={styles.sub}>Ref: {purchase.ref_no}</Text> : null}
        <View style={{ height: spacing.sm }} />
        <Row label={t('subtotal')} value={f.moneyPlain(Number(purchase.subtotal_paisa))} />
        <Row label={t('discount')} value={f.moneyPlain(Number(purchase.discount_paisa))} />
        <Row label={t('freight')} value={f.moneyPlain(Number(purchase.freight_paisa))} />
        <Row label={t('total')} value={f.money(Number(purchase.total_paisa))} bold />
        <Row label={t('paid')} value={f.moneyPlain(Number(purchase.paid_paisa))} tone="success" />
        <Row
          label={t('payable')}
          value={f.moneyPlain(Number(purchase.total_paisa) - Number(purchase.paid_paisa))}
          tone={Number(purchase.total_paisa) > Number(purchase.paid_paisa) ? 'danger' : 'default'}
        />
      </Card>

      <Section title={t('products')}>
        <Card>
          {(lines as unknown as { id: string; product_name: string; qty_micro: number; unit_code: string; unit_cost_paisa: number; line_total_paisa: number; cost_per_base_paisa: number }[]).map(line => (
            <View key={line.id} style={{ marginBottom: spacing.sm }}>
              <Row label={line.product_name} value={f.moneyPlain(Number(line.line_total_paisa))} />
              <Text style={styles.sub}>
                {f.qty(Number(line.qty_micro), line.unit_code)} @ {f.moneyPlain(Number(line.unit_cost_paisa))} ·{' '}
                {f.moneyPlain(Number(line.cost_per_base_paisa))}/base
              </Text>
            </View>
          ))}
        </Card>
      </Section>

      <Section title={t('payments')}>
        <Card>
          {(payments as unknown as { id: string; amount_paisa: number; paid_at: string }[]).map(p => (
            <Row key={p.id} label={f.date(p.paid_at)} value={f.moneyPlain(Number(p.amount_paisa))} />
          ))}
          {payments.length === 0 ? <Text style={styles.sub}>{t('empty')}</Text> : null}
        </Card>
      </Section>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={{ gap: spacing.sm }}>
        <Button
          title={t('print')}
          variant="secondary"
          onPress={async () => {
            const printer = printerBridge();
            if (!printer) {return;}
            try {
              const address = settings?.toMap().printer_address ?? '';
              if (address) {await printer.printBluetooth(address, asText());}
              else {await printer.printText(asText(), 20, purchase.doc_no);}
            } catch (e) {
              setError(messageOf(e));
            }
          }}
        />
        {purchase.status === 'posted' && can(actor.role, 'settings.manage') ? (
          <Button
            title={`${t('delete')} / void`}
            variant="danger"
            onPress={() =>
              Alert.alert(t('confirm'), purchase.doc_no, [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('confirm'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await voidPurchase(db, { purchaseId, reason: 'Reversed by manager', actor });
                      await state.reload();
                    } catch (e) {
                      setError(messageOf(e));
                    }
                  },
                },
              ])
            }
          />
        ) : null}
        <Button title={t('back')} variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.sm },
  receipt: { backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.sm },
});
