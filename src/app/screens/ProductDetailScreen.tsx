import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, Card, ErrorView, LoadingView, Row, Screen, Section } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useDb } from '../store/appStore';
import { productDetail } from '../../services/productService';
import { grossMarginBp } from '../../core/pricing';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const { t, lang } = useI18n();
  const f = useFormat();
  const { productId } = route.params;
  const state = useAsync(() => productDetail(db, productId), [productId]);

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}
  if (!state.data) {return <LoadingView />;}
  const { product, units, movements, sales, purchases } = state.data;
  const marginBp = grossMarginBp(Number(product.sale_price_paisa), Number(product.cost_paisa));

  return (
    <Screen scroll refreshing={state.loading} onRefresh={state.reload}>
      <Card>
        <Text style={styles.name}>{product.name_en}</Text>
        {product.name_ur ? <Text style={styles.urdu}>{product.name_ur}</Text> : null}
        <Text style={styles.muted}>
          {product.code}
          {product.barcode ? ` · ${product.barcode}` : ''} · {product.base_unit}
          {product.is_active ? '' : ` · ${t('archived')}`}
        </Text>
        <View style={{ height: spacing.sm }} />
        <Row label={t('salePrice')} value={f.money(Number(product.sale_price_paisa))} bold />
        <Row label={`${t('cost')} (${t('weightedAverage')})`} value={f.money(Number(product.cost_paisa))} />
        <Row label={t('margin')} value={f.percent(marginBp)} tone={marginBp < 500 ? 'danger' : 'success'} />
        <Row label={t('stock')} value={f.qty(Number(product.stock_micro), product.base_unit)} bold />
        <Row label={t('minStock')} value={f.qty(Number(product.min_stock_micro), product.base_unit)} />
        <Row label={t('stockValue')} value={f.money((Number(product.stock_micro) / 1_000_000) * Number(product.cost_paisa))} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button title={t('edit')} onPress={() => navigation.navigate('ProductForm', { productId })} style={{ flex: 1 }} />
          <Button title={t('restock')} variant="secondary" onPress={() => navigation.navigate('Restock')} style={{ flex: 1 }} />
        </View>
      </Card>

      <Section title={t('packaging')}>
        <Card>
          {units.length === 0 ? (
            <Text style={styles.muted}>{t('none')}</Text>
          ) : (
            units.map(u => (
              <Row
                key={u.id}
                label={`${u.unit_code} · ${u.kind === 'sale' ? t('salePrice') : t('purchasePrice')}`}
                value={`1 ${u.unit_code} = ${Number(u.factor_micro) / 1_000_000} ${product.base_unit}`}
              />
            ))
          )}
        </Card>
      </Section>

      <Section title={t('movements')}>
        <Card>
          {movements.length === 0 ? (
            <Text style={styles.muted}>{t('empty')}</Text>
          ) : (
            movements.map(m => (
              <Row
                key={String(m.id)}
                label={`${String(m.type)} · ${String(m.doc_no ?? '')} · ${f.date(String(m.moved_at))}`}
                value={f.qty(Number(m.qty_micro), product.base_unit)}
                tone={Number(m.qty_micro) < 0 ? 'danger' : 'success'}
              />
            ))
          )}
        </Card>
      </Section>

      <Section title={t('soldProducts')}>
        <Card>
          {sales.length === 0 ? (
            <Text style={styles.muted}>{t('empty')}</Text>
          ) : (
            sales.map((s, i) => (
              <Row
                key={`${s.invoice_no}-${i}`}
                label={`${String(s.invoice_no)} · ${f.date(String(s.sold_at))}`}
                value={`${f.qty(Number(s.qty_micro), String(s.unit_code))} · ${f.moneyPlain(Number(s.line_total_paisa))}`}
              />
            ))
          )}
        </Card>
      </Section>

      <Section title={t('purchases')}>
        <Card>
          {purchases.length === 0 ? (
            <Text style={styles.muted}>{t('empty')}</Text>
          ) : (
            purchases.map((p, i) => (
              <Row
                key={`${p.doc_no}-${i}`}
                label={`${String(p.doc_no)} · ${f.date(String(p.purchased_at))}`}
                value={`${f.qty(Number(p.qty_micro), String(p.unit_code))} @ ${f.moneyPlain(Number(p.unit_cost_paisa))}`}
              />
            ))
          )}
        </Card>
      </Section>

      {!product.is_active ? <Badge text={t('archived')} tone="danger" /> : null}
      <Text style={styles.footer}>{lang === 'ur' ? 'قیمتیں دستاویز کے وقت محفوظ رہتی ہیں' : 'Prices are frozen on each document at transaction time'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  urdu: { fontSize: font.lg, color: colors.muted, marginBottom: spacing.xs },
  muted: { fontSize: font.sm, color: colors.muted },
  footer: { fontSize: font.xs, color: colors.faint, textAlign: 'center', marginTop: spacing.md },
});
