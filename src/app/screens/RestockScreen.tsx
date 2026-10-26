import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, EmptyState, ErrorView, Field, LoadingView, Row, Screen, Section } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useDb } from '../store/appStore';
import { restockSuggestions } from '../../services/adjustmentService';
import { parseQty, QTY_SCALE } from '../../core/money';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function RestockScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const { t } = useI18n();
  const f = useFormat();
  const state = useAsync(() => restockSuggestions(db), []);
  const [selected, setSelected] = useState<Record<string, string>>({});

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}

  const rows = (state.data ?? []) as unknown as Record<string, string | number | null>[];

  const createPurchase = () => {
    const lines = rows
      .map(row => {
        const id = String(row.id);
        const qtyText = selected[id];
        if (!qtyText) {return null;}
        try {
          return {
            productId: id,
            unitCode: String(row.base_unit),
            qtyMicro: parseQty(qtyText),
            unitCostPaisa: Number(row.cost_paisa ?? 0),
          };
        } catch {
          return null;
        }
      })
      .filter((x): x is { productId: string; unitCode: string; qtyMicro: number; unitCostPaisa: number } => !!x);
    if (!lines.length) {return;}
    navigation.navigate('PurchaseForm', { supplierId: rows[0]?.supplier_id ? String(rows[0].supplier_id) : undefined, lines });
  };

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <Card>
        <Text style={styles.heading}>{t('restock')}</Text>
        <Text style={styles.hint}>
          {t('valuationMethod')}: {t('weightedAverage')} · {t('quantity')} = {t('lowStock')} & {t('outOfStock')}
        </Text>
      </Card>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Section title={`${rows.length} ${t('products')}`}>
          {rows.map(row => {
            const suggested = Math.max(
              Number(row.reorder_qty_micro ?? 0),
              Number(row.target_stock_micro ?? 0) - Number(row.stock_micro),
              Number(row.min_stock_micro ?? 0) * 2 - Number(row.stock_micro),
              QTY_SCALE,
            );
            const sold30 = Number(row.sold_30d_micro ?? 0);
            return (
              <Card key={String(row.id)}>
                <Row label={String(row.name_en)} value={f.qty(Number(row.stock_micro), String(row.base_unit))} tone="danger" />
                <Text style={styles.hint}>
                  {t('supplier')}: {String(row.supplier_name ?? '—')} · 30d {t('soldProducts')}:{' '}
                  {f.qty(sold30, String(row.base_unit))}
                </Text>
                <Field
                  label={`${t('quantity')} (${String(row.base_unit)}) — suggested ${f.qty(suggested, String(row.base_unit))}`}
                  value={selected[String(row.id)] ?? ''}
                  keyboardType="decimal-pad"
                  onChangeText={v => setSelected(prev => ({ ...prev, [String(row.id)]: v }))}
                  placeholder={String(suggested / 1_000_000)}
                />
                <Row label={t('cost')} value={f.moneyPlain(Number(row.cost_paisa ?? 0))} />
              </Card>
            );
          })}
        </Section>
      )}

      <Button title={t('newPurchase')} onPress={createPurchase} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  hint: { fontSize: font.xs, color: colors.muted },
});
