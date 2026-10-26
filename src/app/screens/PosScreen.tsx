import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, EmptyState, Field, ModalSheet, Row, SelectField, LoadingView } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useActor, useDb, useAppStore } from '../store/appStore';
import { cartTotals, useCart } from '../store/cartStore';
import { listProducts, productByBarcode, productSaleUnits } from '../../services/productService';
import { paymentMethods } from '../../services/paymentService';
import type { PaymentMethodRow } from '../../db/types';
import { createSale, saleDetail } from '../../services/salesService';
import { buildReceipt } from '../../services/receiptService';
import { printerBridge } from '../../native/bridge';
import { mulDivRound, parseQty, QTY_SCALE, formatQty } from '../../core/money';
import { deriveUnitPrice } from '../../core/pricing';
import { messageOf } from '../../core/errors';
import type { ProductRow, ProductUnitRow } from '../../db/types';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Mode = 'browse' | 'cart';

export default function PosScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const actor = useActor();
  const settings = useAppStore(s => s.settings);
  const { t } = useI18n();
  const f = useFormat();
  const cart = useCart();
  const totals = useMemo(() => cartTotals(cart), [cart]);

  const [mode, setMode] = useState<Mode>('browse');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [editKey, setEditKey] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editDiscount, setEditDiscount] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editUnits, setEditUnits] = useState<ProductUnitRow[]>([]);

  const [customerPicker, setCustomerPicker] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<{ id: string; name_en: string; balance_paisa: number }[]>([]);

  const [checkout, setCheckout] = useState(false);
  const [payments, setPayments] = useState<{ methodId: string; amountText: string; reference: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<{ text: string; saleId: string; invoiceNo: string } | null>(null);
  const [discountText, setDiscountText] = useState('');

  useEffect(() => {
    void (async () => {
      setMethods(await paymentMethods(db));
      setResults(await listProducts(db, { limit: 20, sort: 'recent' }));
    })();
  }, [db]);

  useEffect(() => {
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await listProducts(db, { query: query.trim(), limit: 30, sort: query ? 'name' : 'recent' }));
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [db, query]);

  const searchCustomers = async (text: string) => {
    setCustomerQuery(text);
    const rows = await db.query(
      `SELECT id, name_en, balance_paisa FROM customers WHERE is_active = 1 AND search_blob LIKE ? ORDER BY name_en LIMIT 15`,
      [`%${text.trim().toLowerCase()}%`],
    );
    setCustomerResults(rows.map(r => ({ id: String(r.id), name_en: String(r.name_en), balance_paisa: Number(r.balance_paisa) })));
  };

  const addProduct = async (product: ProductRow, unitCode?: string) => {
    setError(null);
    try {
      const units = await productSaleUnits(db, product.id);
      const unit = unitCode ? units.find(u => u.unit_code === unitCode) : units.find(u => u.unit_code === product.base_unit);
      const chosen = unit ?? units[0];
      const factorMicro = chosen ? Number(chosen.factor_micro) : QTY_SCALE;
      const price =
        chosen && chosen.price_paisa !== null
          ? Number(chosen.price_paisa)
          : deriveUnitPrice(Number(product.sale_price_paisa), factorMicro, settings?.priceRounding ?? 'paisa');
      cart.add({
        productId: product.id,
        name: product.name_en,
        baseUnit: product.base_unit,
        unitCode: chosen?.unit_code ?? product.base_unit,
        factorMicro,
        qtyMicro: QTY_SCALE,
        unitPricePaisa: price,
        stockMicro: Number(product.stock_micro),
        taxBp: settings?.taxEnabled ? Number(product.tax_bp) : 0,
      });
      setCustomerPicker(false);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const handleScan = async () => {
    const code = query.trim();
    if (!code) {return;}
    const product = await productByBarcode(db, code);
    if (product) {
      await addProduct(product);
      setQuery('');
    } else {
      setError(`${t('barcode')} — ${t('empty')}`);
    }
  };

  const openEdit = async (key: string) => {
    const item = cart.items.find(i => i.key === key);
    if (!item) {return;}
    setEditKey(key);
    setEditUnit(item.unitCode);
    setEditQty(formatQty(item.qtyMicro, 3));
    setEditPrice((item.unitPricePaisa / 100).toString());
    setEditDiscount((item.lineDiscountPaisa / 100).toString());
    setEditUnits(await productSaleUnits(db, item.productId));
  };

  const applyEdit = () => {
    if (!editKey) {return;}
    const item = cart.items.find(i => i.key === editKey);
    if (!item) {return;}
    try {
      const units = editUnits.find(u => u.unit_code === editUnit);
      const factorMicro = units ? Number(units.factor_micro) : item.factorMicro;
      const qtyMicro = parseQty(editQty || '0');
      if (qtyMicro <= 0) {throw new Error(t('quantity'));}
      const pricePaisa = Math.round(parseFloat(editPrice || '0') * 100);
      if (!Number.isFinite(pricePaisa) || pricePaisa < 0) {throw new Error(t('price'));}
      const discountPaisa = Math.round(parseFloat(editDiscount || '0') * 100) || 0;
      cart.update(editKey, {
        unitCode: editUnit,
        factorMicro,
        qtyMicro,
        unitPricePaisa: pricePaisa,
        lineDiscountPaisa: Math.max(0, discountPaisa),
      });
      setEditKey(null);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const openCheckout = () => {
    if (!cart.items.length) {return;}
    setError(null);
    const cash = methods.find(m => m.is_cash === 1) ?? methods[0];
    setPayments([{ methodId: cash?.id ?? 'pm_cash', amountText: (totals.totalPaisa / 100).toString(), reference: '' }]);
    setCheckout(true);
  };

  const paidPaisa = payments.reduce((sum, p) => sum + Math.round(parseFloat(p.amountText || '0') * 100), 0);
  const remaining = totals.totalPaisa - paidPaisa;

  const completeSale = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await createSale(db, {
        lines: cart.items.map(i => ({
          productId: i.productId,
          unitCode: i.unitCode,
          qtyMicro: i.qtyMicro,
          factorMicro: i.factorMicro,
          unitPricePaisa: i.unitPricePaisa,
          lineDiscountPaisa: i.lineDiscountPaisa,
        })),
        customerId: cart.customerId,
        payments: payments
          .filter(p => Math.round(parseFloat(p.amountText || '0') * 100) > 0)
          .map(p => ({ methodId: p.methodId, amountPaisa: Math.round(parseFloat(p.amountText || '0') * 100), reference: p.reference || null })),
        discountBp: cart.discountBp,
        discountPaisa: cart.discountPaisa,
        clientRef: cart.clientRef,
        actor,
      });

      const detail = await saleDetail(db, result.saleId);
      const text = buildReceipt({
        sale: detail.sale,
        lines: detail.lines,
        payments: await Promise.all(
          (detail.payments as unknown as { method_id: string; amount_paisa: number }[]).map(async p => ({
            methodName: methods.find(m => m.id === p.method_id)?.name_en ?? '',
            amountPaisa: Number(p.amount_paisa),
          })),
        ),
        store: {
          nameEn: settings?.storeName ?? 'General Store',
          nameUr: settings?.storeNameUr ?? '',
          address: settings?.address ?? '',
          phone: settings?.phone ?? '',
          footer: settings?.receiptFooter ?? '',
          terms: settings?.receiptTerms ?? '',
          returnPolicy: settings?.returnPolicy ?? '',
        },
        customerBalancePaisa: cart.customerId ? undefined : undefined,
        language: settings?.receiptLanguage ?? 'en',
        cashier: actor.name,
      });
      setReceipt({ text, saleId: result.saleId, invoiceNo: result.invoiceNo });
      cart.clear();
      setCheckout(false);
      setMode('browse');
      setResults(await listProducts(db, { limit: 20, sort: 'recent' }));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const printReceipt = async (text: string, jobName: string) => {
    const printer = printerBridge();
    if (!printer) {
      Alert.alert(t('print'), 'Printer bridge unavailable (build the Android app to print).');
      return;
    }
    try {
      const address = settings?.toMap().printer_address ?? '';
      if (address) {
        await printer.printBluetooth(address, text);
      } else {
        await printer.printText(text, (settings?.receiptFontSize ?? 10) * 2, jobName);
      }
    } catch (e) {
      Alert.alert(t('print'), messageOf(e));
    }
  };

  const lineLabel = (unitCode: string, factorMicro: number, baseUnit: string) =>
    unitCode === baseUnit ? baseUnit : `${unitCode} (${formatQty(factorMicro, 3)} ${baseUnit})`;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.modeSwitch}>
          <Pressable style={[styles.modeTab, mode === 'browse' && styles.modeTabActive]} onPress={() => setMode('browse')}>
            <Text style={[styles.modeText, mode === 'browse' && styles.modeTextActive]}>{t('products')}</Text>
          </Pressable>
          <Pressable style={[styles.modeTab, mode === 'cart' && styles.modeTabActive]} onPress={() => setMode('cart')}>
            <Text style={[styles.modeText, mode === 'cart' && styles.modeTextActive]}>
              {t('cart')} ({cart.items.length})
            </Text>
          </Pressable>
        </View>
        <Pressable style={styles.customerChip} onPress={() => { setCustomerPicker(true); void searchCustomers(''); }}>
          <Text style={styles.customerChipText} numberOfLines={1}>
            {cart.customerName ?? t('walkIn')}
          </Text>
        </Pressable>
      </View>

      {mode === 'browse' ? (
        <>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleScan}
              placeholder={`${t('search')} / ${t('barcode')}`}
              placeholderTextColor={colors.faint}
              style={styles.search}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && results.length === 0 ? (
            <LoadingView />
          ) : (
            <FlatList
              data={results}
              keyExtractor={item => item.id}
              numColumns={2}
              columnWrapperStyle={{ gap: spacing.sm }}
              contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: 120 }}
              ListEmptyComponent={<EmptyState message={`${t('search')} — ${t('name')} / ${t('barcode')}`} />}
              renderItem={({ item }) => (
                <Pressable style={styles.productTile} onPress={() => addProduct(item)}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {item.name_en}
                  </Text>
                  <Text style={styles.productPrice}>{f.moneyPlain(Number(item.sale_price_paisa))}</Text>
                  <Text style={styles.productStock}>
                    {f.qty(Number(item.stock_micro), item.base_unit)}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 140 }}>
          {cart.items.length === 0 ? (
            <EmptyState message={t('emptyCart')} action={<Button title={t('products')} onPress={() => setMode('browse')} />} />
          ) : (
            <Card>
              {cart.items.map(item => {
                const gross = mulDivRound(item.unitPricePaisa, item.qtyMicro, QTY_SCALE);
                return (
                  <Pressable key={item.key} onPress={() => openEdit(item.key)} style={styles.cartRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.cartSub}>
                        {f.qty(item.qtyMicro, item.unitCode)} × {f.moneyPlain(item.unitPricePaisa)}
                      </Text>
                    </View>
                    <Text style={styles.cartTotal}>{f.moneyPlain(gross - item.lineDiscountPaisa)}</Text>
                    <Pressable onPress={() => cart.remove(item.key)} hitSlop={10} style={{ paddingHorizontal: spacing.sm }}>
                      <Text style={{ color: colors.danger, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  </Pressable>
                );
              })}
            </Card>
          )}

          <Card>
            <Row label={t('subtotal')} value={f.moneyPlain(totals.subtotalPaisa)} />
            {totals.lineDiscountPaisa > 0 ? (
              <Row label={t('discount')} value={`-${f.moneyPlain(totals.lineDiscountPaisa)}`} tone="danger" />
            ) : null}
            {totals.cartDiscountPaisa > 0 ? (
              <Row label={t('cartDiscount')} value={`-${f.moneyPlain(totals.cartDiscountPaisa)}`} tone="danger" />
            ) : null}
            {totals.taxPaisa > 0 ? <Row label={t('tax')} value={f.moneyPlain(totals.taxPaisa)} /> : null}
            <Row label={t('total')} value={f.moneyPlain(totals.totalPaisa)} bold />
          </Card>

          <Card>
            <Text style={styles.sectionLabel}>{t('cartDiscount')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Field
                label={t('fixedAmount')}
                value={discountText}
                onChangeText={setDiscountText}
                keyboardType="decimal-pad"
                placeholder="0"
              />
              <Button
                title={t('apply')}
                variant="secondary"
                onPress={() => cart.setDiscount({ discountPaisa: Math.round(parseFloat(discountText || '0') * 100) || 0 })}
                style={{ height: 48, marginTop: 20 }}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {[5, 10, 15].map(pct => (
                <Button
                  key={pct}
                  title={`${pct}%`}
                  small
                  variant="secondary"
                  onPress={() => {
                    setDiscountText('');
                    cart.setDiscount({ discountPaisa: 0, discountBp: pct * 100 });
                  }}
                />
              ))}
              <Button title={t('none')} small variant="ghost" onPress={() => { setDiscountText(''); cart.setDiscount({ discountBp: 0, discountPaisa: 0 }); }} />
            </View>
          </Card>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      )}

      <View style={styles.bottomBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bottomTotal}>{f.money(totals.totalPaisa)}</Text>
          <Text style={styles.cartSub}>
            {cart.items.length} {t('products')}
          </Text>
        </View>
        <Button title={t('checkout')} onPress={openCheckout} disabled={!cart.items.length} style={{ minWidth: 150 }} />
      </View>

      {/* line editor */}
      <ModalSheet visible={!!editKey} onClose={() => setEditKey(null)} title={t('edit')}>
        <SelectField
          label={t('unit')}
          value={editUnit}
          options={editUnits.map(u => ({
            value: u.unit_code,
            label: lineLabel(u.unit_code, Number(u.factor_micro), cart.items.find(i => i.key === editKey)?.baseUnit ?? ''),
          }))}
          onChange={setEditUnit}
        />
        <Field label={t('quantity')} value={editQty} onChangeText={setEditQty} keyboardType="decimal-pad" />
        <Field label={`${t('price')} / ${t('unit')}`} value={editPrice} onChangeText={setEditPrice} keyboardType="decimal-pad" />
        <Field label={t('discount')} value={editDiscount} onChangeText={setEditDiscount} keyboardType="decimal-pad" />
        <Button title={t('apply')} onPress={applyEdit} />
      </ModalSheet>

      {/* customer picker */}
      <ModalSheet visible={customerPicker} onClose={() => setCustomerPicker(false)} title={t('selectCustomer')}>
        <Field label={t('search')} value={customerQuery} onChangeText={searchCustomers} placeholder={t('name')} />
        <Button
          title={t('walkIn')}
          variant="secondary"
          onPress={() => {
            cart.setCustomer(null, null);
            setCustomerPicker(false);
          }}
        />
        <View style={{ height: spacing.md }} />
        {customerResults.map(c => (
          <Pressable
            key={c.id}
            style={styles.customerRow}
            onPress={() => {
              cart.setCustomer(c.id, c.name_en);
              setCustomerPicker(false);
            }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cartName}>{c.name_en}</Text>
              <Text style={styles.cartSub}>
                {t('balance')}: {f.moneyPlain(c.balance_paisa)}
              </Text>
            </View>
            <Text style={{ color: colors.primary }}>›</Text>
          </Pressable>
        ))}
        <Button title={t('addCustomer')} variant="ghost" onPress={() => { setCustomerPicker(false); navigation.navigate('PartyForm', { partyType: 'customer' }); }} />
      </ModalSheet>

      {/* checkout */}
      <ModalSheet visible={checkout} onClose={() => setCheckout(false)} title={`${t('checkout')} · ${f.moneyPlain(totals.totalPaisa)}`}>
        <Card>
          <Row label={t('total')} value={f.money(totals.totalPaisa)} bold />
          <Row label={t('discount')} value={f.moneyPlain(totals.lineDiscountPaisa + totals.cartDiscountPaisa)} />
          {totals.taxPaisa > 0 ? <Row label={t('tax')} value={f.moneyPlain(totals.taxPaisa)} /> : null}
          <Row
            label={t('remaining')}
            value={f.moneyPlain(Math.max(0, remaining))}
            tone={remaining > 0 ? 'danger' : 'success'}
            bold
          />
        </Card>

        {payments.map((p, index) => (
          <Card key={index}>
            <SelectField
              label={t('paymentMethod')}
              value={p.methodId}
              options={methods.filter(m => !m.is_credit).map(m => ({ value: m.id, label: m.name_en }))}
              onChange={v => setPayments(prev => prev.map((x, i) => (i === index ? { ...x, methodId: v } : x)))}
            />
            <Field
              label={t('amount')}
              value={p.amountText}
              keyboardType="decimal-pad"
              onChangeText={v => setPayments(prev => prev.map((x, i) => (i === index ? { ...x, amountText: v } : x)))}
            />
            {payments.length > 1 ? (
              <Button title={t('delete')} variant="ghost" small onPress={() => setPayments(prev => prev.filter((_, i) => i !== index))} />
            ) : null}
          </Card>
        ))}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          <Button
            title={t('splitPayment')}
            variant="secondary"
            small
            onPress={() =>
              setPayments(prev => [
                ...prev,
                { methodId: methods.find(m => !m.is_credit && m.is_cash === 0)?.id ?? 'pm_bank', amountText: '', reference: '' },
              ])
            }
          />
          <Button
            title={t('paid')}
            variant="ghost"
            small
            onPress={() => setPayments([{ ...payments[0], amountText: (totals.totalPaisa / 100).toString() }])}
          />
        </View>

        {remaining > 0 ? (
          <Card style={{ backgroundColor: cart.customerId ? colors.warningSoft : colors.dangerSoft }}>
            <Text style={{ color: cart.customerId ? colors.warning : colors.danger, fontWeight: '700' }}>
              {cart.customerId ? `${t('credit')}: ${f.moneyPlain(remaining)}` : t('walkInCreditBlocked')}
            </Text>
          </Card>
        ) : remaining < 0 ? (
          <Row label={t('changeDue')} value={f.moneyPlain(-remaining)} tone="success" />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title={saving ? t('saving') : t('completeSale')}
          onPress={completeSale}
          loading={saving}
          disabled={remaining > 0 && !cart.customerId}
        />
      </ModalSheet>

      {/* receipt */}
      <ModalSheet
        visible={!!receipt}
        onClose={() => setReceipt(null)}
        title={`${t('receipt')} ${receipt?.invoiceNo ?? ''}`}
        footer={
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              title={t('print')}
              style={{ flex: 1 }}
              onPress={() => receipt && printReceipt(receipt.text, receipt.invoiceNo)}
            />
            <Button title={t('close')} variant="secondary" style={{ flex: 1 }} onPress={() => setReceipt(null)} />
          </View>
        }>
        <View style={styles.receipt}>
          <Text style={styles.receiptText}>{receipt?.text}</Text>
        </View>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { padding: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  modeSwitch: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 3 },
  modeTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.pill },
  modeTabActive: { backgroundColor: colors.primary },
  modeText: { fontSize: font.sm, fontWeight: '700', color: colors.muted },
  modeTextActive: { color: colors.onPrimary },
  customerChip: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  customerChipText: { color: colors.primaryDark, fontWeight: '700', fontSize: font.sm },
  searchRow: { paddingHorizontal: spacing.md },
  search: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontSize: font.md,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  productTile: {
    flex: 1,
    minHeight: 92,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'space-between',
  },
  productName: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  productPrice: { fontSize: font.md, fontWeight: '800', color: colors.primary },
  productStock: { fontSize: font.xs, color: colors.muted },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  cartName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  cartSub: { fontSize: font.xs, color: colors.muted },
  cartTotal: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sectionLabel: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  error: { color: colors.danger, fontWeight: '600', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bottomTotal: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  receipt: { backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  receiptText: { fontFamily: 'monospace', fontSize: 11, color: '#111' },
});
