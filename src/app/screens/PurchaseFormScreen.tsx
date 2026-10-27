import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Field, ModalSheet, Row, Screen, SelectField, Section } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useActor, useDb, useAppStore } from '../store/appStore';
import { createPurchase } from '../../services/purchaseService';
import { listProducts } from '../../services/productService';
import { paymentMethods } from '../../services/paymentService';
import { parseMoney, parseQty, QTY_SCALE } from '../../core/money';
import { costPerBaseUnit, lineTotal, marginPreview } from '../../core/pricing';
import { messageOf } from '../../core/errors';
import { showToast } from '../toast';
import type { ProductRow, ProductUnitRow } from '../../db/types';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'PurchaseForm'>;

interface LineDraft {
  key: string;
  productId: string;
  name: string;
  baseUnit: string;
  unitCode: string;
  qtyText: string;
  costText: string;
  units: { code: string; factorMicro: number }[];
  salePricePaisa: number;
}

let keyCounter = 0;

export default function PurchaseFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const actor = useActor();
  const settings = useAppStore(s => s.settings);
  const { t } = useI18n();
  const f = useFormat();

  const [suppliers, setSuppliers] = useState<{ value: string; label: string }[]>([]);
  const [methods, setMethods] = useState<{ id: string; label: string; isCash: number }[]>([]);
  const [supplierId, setSupplierId] = useState<string>(route.params?.supplierId ?? '');
  const [refNo, setRefNo] = useState('');
  const [discountText, setDiscountText] = useState('');
  const [freightText, setFreightText] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [payments, setPayments] = useState<{ methodId: string; amountText: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<ProductRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const sup = await db.query('SELECT id, name_en FROM suppliers WHERE is_active = 1 ORDER BY name_en');
      setSuppliers(sup.map(s => ({ value: String(s.id), label: String(s.name_en) })));
      const pm = await paymentMethods(db);
      setMethods(pm.filter(m => !m.is_credit).map(m => ({ id: m.id, label: m.name_en, isCash: Number(m.is_cash) })));
      setPayments([{ methodId: pm.find(m => m.is_cash)?.id ?? 'pm_cash', amountText: '' }]);
    })();
  }, [db]);

  useEffect(() => {
    const id = setTimeout(async () => {
      setProductResults(await listProducts(db, { query: productQuery.trim(), limit: 25 }));
    }, 200);
    return () => clearTimeout(id);
  }, [db, productQuery]);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const line of lines) {
      try {
        const qty = parseQty(line.qtyText || '0');
        const cost = parseMoney(line.costText || '0');
        subtotal += lineTotal(cost, qty);
      } catch {
        // incomplete line
      }
    }
    let discount = 0;
    let freight = 0;
    try {discount = parseMoney(discountText || '0');} catch {discount = 0;}
    try {freight = parseMoney(freightText || '0');} catch {freight = 0;}
    return { subtotal, discount, freight, total: subtotal - discount + freight };
  }, [lines, discountText, freightText]);

  const paid = payments.reduce((sum, p) => {
    try {
      return sum + parseMoney(p.amountText || '0');
    } catch {
      return sum;
    }
  }, 0);

  const addProduct = async (product: ProductRow) => {
    const rows = await db.query(
      `SELECT unit_code, factor_micro FROM product_units WHERE product_id = ? AND kind = 'purchase'`,
      [product.id],
    );
    const units = [
      { code: product.base_unit, factorMicro: QTY_SCALE },
      ...(rows as unknown as ProductUnitRow[]).map(u => ({ code: u.unit_code, factorMicro: Number(u.factor_micro) })),
    ];
    const unit = units[0];
    setLines(prev => [
      ...prev,
      {
        key: `l${(keyCounter += 1)}`,
        productId: product.id,
        name: product.name_en,
        baseUnit: product.base_unit,
        unitCode: unit.code,
        qtyText: '1',
        costText: (Number(product.cost_paisa) / 100).toString(),
        units,
        salePricePaisa: Number(product.sale_price_paisa),
      },
    ]);
    setPickerOpen(false);
    setProductQuery('');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!lines.length) {throw new Error(`${t('products')} — ${t('required')}`);}
      const payload = lines.map(line => ({
        productId: line.productId,
        unitCode: line.unitCode,
        qtyMicro: parseQty(line.qtyText || '0'),
        factorMicro: line.units.find(u => u.code === line.unitCode)?.factorMicro,
        unitCostPaisa: parseMoney(line.costText || '0'),
      }));
      const result = await createPurchase(db, {
        supplierId: supplierId || null,
        refNo: refNo || null,
        lines: payload,
        discountPaisa: discountText ? parseMoney(discountText) : 0,
        freightPaisa: freightText ? parseMoney(freightText) : 0,
        notes: notes || null,
        payments: payments
          .filter(p => p.amountText.trim())
          .map(p => ({ methodId: p.methodId, amountPaisa: parseMoney(p.amountText) })),
        actor,
      });
      navigation.replace('PurchaseDetail', { purchaseId: result.purchaseId });
      showToast(t('purchaseSaved'));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Card>
        <SelectField
          label={t('supplier')}
          value={supplierId}
          options={[{ value: '', label: t('none') }, ...suppliers]}
          onChange={setSupplierId}
        />
        <Field label={t('supplierInvoice')} value={refNo} onChangeText={setRefNo} />
        <Field label={t('notes')} value={notes} onChangeText={setNotes} multiline />
      </Card>

      <Section title={t('products')} action={<Button title={`+ ${t('mixedUnits')}`} small variant="secondary" onPress={() => setPickerOpen(true)} />}>
        {lines.length === 0 ? (
          <Card>
            <Text style={styles.muted}>{t('empty')}</Text>
          </Card>
        ) : (
          lines.map(line => {
            const qty = (() => { try { return parseQty(line.qtyText || '0'); } catch { return 0; } })();
            const cost = (() => { try { return parseMoney(line.costText || '0'); } catch { return 0; } })();
            const factor = line.units.find(u => u.code === line.unitCode)?.factorMicro ?? QTY_SCALE;
            const preview = marginPreview({
              unitCostPaisa: cost,
              factorMicro: factor,
              baseSellPricePaisa: line.salePricePaisa,
              rounding: settings?.priceRounding ?? 'paisa',
            });
            return (
              <Card key={line.key}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.lineTitle}>{line.name}</Text>
                  <Pressable onPress={() => setLines(prev => prev.filter(l => l.key !== line.key))}>
                    <Text style={{ color: colors.danger, fontWeight: '700' }}>✕</Text>
                  </Pressable>
                </View>
                <SelectField
                  label={t('unit')}
                  value={line.unitCode}
                  options={line.units.map(u => ({ value: u.code, label: `${u.code} (× ${u.factorMicro / 1_000_000} ${line.baseUnit})` }))}
                  onChange={v => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, unitCode: v } : l)))}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={`${t('quantity')} (${line.unitCode})`}
                      value={line.qtyText}
                      keyboardType="decimal-pad"
                      onChangeText={v => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, qtyText: v } : l)))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={`${t('cost')} / ${line.unitCode}`}
                      value={line.costText}
                      keyboardType="decimal-pad"
                      onChangeText={v => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, costText: v } : l)))}
                    />
                  </View>
                </View>
                <Row label={t('cost')} value={`${f.money(costPerBaseUnit(cost, factor))} / ${line.baseUnit}`} />
                <Row label={t('total')} value={f.moneyPlain(lineTotal(cost, qty))} bold />
                <Row
                  label={`${t('derivedPrice')} (${line.baseUnit})`}
                  value={`${f.moneyPlain(preview.unitSellPricePaisa)} · ${t('margin')} ${(preview.marginBp / 100).toFixed(1)}%`}
                  tone={preview.marginBp < 0 ? 'danger' : 'success'}
                />
              </Card>
            );
          })
        )}
      </Section>

      <Card>
        <Row label={t('subtotal')} value={f.moneyPlain(totals.subtotal)} />
        <Field label={t('discount')} value={discountText} onChangeText={setDiscountText} keyboardType="decimal-pad" />
        <Field label={t('freight')} value={freightText} onChangeText={setFreightText} keyboardType="decimal-pad" />
        <Row label={t('total')} value={f.money(totals.total)} bold />
      </Card>

      <Section title={t('payments')}>
        {payments.map((p, index) => (
          <Card key={index}>
            <SelectField
              label={t('paymentMethod')}
              value={p.methodId}
              options={methods.map(m => ({ value: m.id, label: m.label }))}
              onChange={v => setPayments(prev => prev.map((x, i) => (i === index ? { ...x, methodId: v } : x)))}
            />
            <Field
              label={t('amount')}
              value={p.amountText}
              keyboardType="decimal-pad"
              onChangeText={v => setPayments(prev => prev.map((x, i) => (i === index ? { ...x, amountText: v } : x)))}
            />
          </Card>
        ))}
        <Button
          title={`+ ${t('splitPayment')}`}
          small
          variant="secondary"
          onPress={() => setPayments(prev => [...prev, { methodId: methods[0]?.id ?? 'pm_cash', amountText: '' }])}
        />
      </Section>

      <Card>
        <Row label={t('paid')} value={f.moneyPlain(paid)} tone="success" />
        <Row label={t('payable')} value={f.moneyPlain(Math.max(0, totals.total - paid))} tone={totals.total > paid ? 'danger' : 'default'} bold />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={busy ? t('saving') : t('savePurchase')} onPress={save} loading={busy} />

      <ModalSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t('products')}>
        <TextInput
          value={productQuery}
          onChangeText={setProductQuery}
          placeholder={t('search')}
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
        <ScrollView style={{ maxHeight: 400 }}>
          {productResults.map(product => (
            <Pressable key={product.id} style={styles.pickRow} onPress={() => addProduct(product)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineTitle}>{product.name_en}</Text>
                <Text style={styles.muted}>
                  {f.qty(Number(product.stock_micro), product.base_unit)} · {product.base_unit}
                </Text>
              </View>
              <Text style={{ color: colors.primary }}>+</Text>
            </Pressable>
          ))}
        </ScrollView>
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: font.sm, color: colors.muted },
  lineTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, flex: 1 },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.md },
  search: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontSize: font.md,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
