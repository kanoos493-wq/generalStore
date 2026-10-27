import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Field, LoadingView, Row, Screen, SelectField, Section } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useActor, useDb } from '../store/appStore';
import { createProduct, productDetail, suggestedFactor, updateProduct, type ProductUnitInput } from '../../services/productService';
import { parseMoney, parseQty, MONEY_SCALE } from '../../core/money';
import { deriveUnitPrice, marginPreview } from '../../core/pricing';
import { messageOf } from '../../core/errors';
import { showToast } from '../toast';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ProductForm'>;

interface UnitDraft {
  key: string;
  unitCode: string;
  kind: 'purchase' | 'sale';
  factorText: string;
  priceText: string;
}

let draftKey = 0;
const nextKey = () => `u${(draftKey += 1)}`;

export default function ProductFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const actor = useActor();
  const { t } = useI18n();
  const f = useFormat();
  const productId = route.params?.productId;

  const [loading, setLoading] = useState(!!productId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nameEn, setNameEn] = useState('');
  const [nameUr, setNameUr] = useState('');
  const [code, setCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [baseUnit, setBaseUnit] = useState('kg');
  const [salePrice, setSalePrice] = useState('');
  const [openingStock, setOpeningStock] = useState('');
  const [openingCost, setOpeningCost] = useState('');
  const [minStock, setMinStock] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>('cat_general');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [units, setUnits] = useState<UnitDraft[]>([]);

  const [unitOptions, setUnitOptions] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ value: string; label: string }[]>([]);
  const [qtyUnitLabel, setQtyUnitLabel] = useState('kg');

  useEffect(() => {
    void (async () => {
      const unitRows = await db.query('SELECT code, name_en, dimension FROM units ORDER BY dimension, canonical_micro DESC');
      setUnitOptions(unitRows.map(u => ({ value: String(u.code), label: `${u.name_en} (${u.code})` })));
      const catRows = await db.query('SELECT id, name_en FROM categories ORDER BY name_en');
      setCategories(catRows.map(c => ({ value: String(c.id), label: String(c.name_en) })));
      const supRows = await db.query('SELECT id, name_en FROM suppliers WHERE is_active = 1 ORDER BY name_en');
      setSuppliers(supRows.map(s => ({ value: String(s.id), label: String(s.name_en) })));

      if (productId) {
        const detail = await productDetail(db, productId);
        const p = detail.product;
        setNameEn(p.name_en);
        setNameUr(p.name_ur ?? '');
        setCode(p.code);
        setBarcode(p.barcode ?? '');
        setBaseUnit(p.base_unit);
        setQtyUnitLabel(p.base_unit);
        setSalePrice((Number(p.sale_price_paisa) / MONEY_SCALE).toString());
        setMinStock((Number(p.min_stock_micro) / 1_000_000).toString());
        setNotes(p.notes ?? '');
        setCategoryId(p.category_id);
        setSupplierId(p.supplier_id);
        setUnits(
          detail.units.map(u => ({
            key: nextKey(),
            unitCode: u.unit_code,
            kind: u.kind,
            factorText: (Number(u.factor_micro) / 1_000_000).toString(),
            priceText: u.price_paisa === null ? '' : (Number(u.price_paisa) / MONEY_SCALE).toString(),
          })),
        );
        setLoading(false);
      }
    })();
  }, [db, productId]);

  const parsedPrice = useMemo(() => {
    try {
      return parseMoney(salePrice || '0');
    } catch {
      return null;
    }
  }, [salePrice]);

  const save = async () => {
    setError(null);
    try {
      if (!nameEn.trim()) {throw new Error(`${t('productName')} — ${t('required')}`);}
      const pricePaisa = parseMoney(salePrice || '0');
      if (pricePaisa < 0) {throw new Error(t('price'));}
      const unitInputs: ProductUnitInput[] = units
        .filter(u => u.unitCode)
        .map(u => ({
          unitCode: u.unitCode,
          kind: u.kind,
          factorMicro: parseQty(u.factorText || '1'),
          pricePaisa: u.priceText ? parseMoney(u.priceText) : null,
        }));

      setSaving(true);
      if (productId) {
        await updateProduct(db, {
          id: productId,
          nameEn,
          nameUr: nameUr || null,
          code,
          barcode: barcode || null,
          baseUnit,
          salePricePaisa: pricePaisa,
          minStockMicro: parseQty(minStock || '0'),
          categoryId,
          supplierId,
          notes: notes || null,
          units: unitInputs,
          actor,
        });
      } else {
        await createProduct(db, {
          nameEn,
          nameUr: nameUr || null,
          code: code || null,
          barcode: barcode || null,
          baseUnit,
          salePricePaisa: pricePaisa,
          minStockMicro: parseQty(minStock || '0'),
          openingStockMicro: openingStock ? parseQty(openingStock) : 0,
          openingCostPaisa: openingCost ? parseMoney(openingCost) : 0,
          categoryId,
          supplierId,
          notes: notes || null,
          units: unitInputs,
          actor,
        });
      }
      showToast(productId ? t('toastUpdated') : t('toastSaved'));
      navigation.goBack();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  const addUnit = async (kind: 'purchase' | 'sale') => {
    const candidate = kind === 'sale' ? 'g' : 'bag';
    let factor = 1;
    try {
      factor = (await suggestedFactor(baseUnit, candidate)) / 1_000_000;
    } catch {
      factor = 1;
    }
    setUnits(prev => [
      ...prev,
      { key: nextKey(), unitCode: candidate, kind, factorText: factor.toString(), priceText: '' },
    ]);
  };

  if (loading) {return <LoadingView />;}

  const preview = units.filter(u => u.kind === 'sale' && Number(u.factorText) > 0).slice(0, 2);

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.heading}>{t('productName')}</Text>
        <Field label={t('nameEn')} value={nameEn} onChangeText={setNameEn} placeholder="Sugar" />
        <Field label={t('nameUr')} value={nameUr} onChangeText={setNameUr} placeholder="چینی" />
        <Field label={t('sku')} value={code} onChangeText={setCode} placeholder="auto" hint="auto-generated when empty" />
        <Field
          label={`${t('barcode')} (${t('optional')})`}
          value={barcode}
          onChangeText={setBarcode}
          keyboardType="number-pad"
          hint={t('scanHint')}
        />
        <SelectField label={t('baseUnit')} value={baseUnit} options={unitOptions} onChange={v => { setBaseUnit(v); setQtyUnitLabel(v); }} />
        <SelectField label={t('category')} value={categoryId ?? ''} options={categories} onChange={setCategoryId} />
        <SelectField
          label={t('supplier')}
          value={supplierId ?? ''}
          options={[{ value: '', label: t('none') }, ...suppliers]}
          onChange={v => setSupplierId(v || null)}
        />
      </Card>

      <Card>
        <Text style={styles.heading}>{t('pricing')}</Text>
        <Field
          label={`${t('salePrice')} / ${qtyUnitLabel}`}
          value={salePrice}
          onChangeText={setSalePrice}
          keyboardType="decimal-pad"
          placeholder="150"
        />
        <Field label={`${t('minStock')} (${qtyUnitLabel})`} value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" />
        {!productId ? (
          <>
            <Field label={`${t('openingStock')} (${qtyUnitLabel})`} value={openingStock} onChangeText={setOpeningStock} keyboardType="decimal-pad" />
            <Field
              label={`${t('purchasePrice')} (${t('openingStock')})`}
              value={openingCost}
              onChangeText={setOpeningCost}
              keyboardType="decimal-pad"
            />
          </>
        ) : null}
        <Field label={t('notes')} value={notes} onChangeText={setNotes} multiline />
      </Card>

      <Section
        title={t('packaging')}
        action={
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={`+ ${t('purchasePrice')}`} small variant="secondary" onPress={() => addUnit('purchase')} />
            <Button title={`+ ${t('salePrice')}`} small variant="secondary" onPress={() => addUnit('sale')} />
          </View>
        }>
        <Card>
          {units.length === 0 ? (
            <Text style={styles.muted}>
              {t('packaging')} — e.g. bag = 10 {baseUnit}, box = 6 pieces
            </Text>
          ) : (
            units.map(u => (
              <View key={u.key} style={styles.unitRow}>
                <View style={{ flex: 1 }}>
                  <SelectField
                    value={u.unitCode}
                    options={unitOptions}
                    onChange={v => setUnits(prev => prev.map(x => (x.key === u.key ? { ...x, unitCode: v } : x)))}
                  />
                </View>
                <View style={{ width: 110 }}>
                  <Field
                    label={`× ${baseUnit}`}
                    value={u.factorText}
                    keyboardType="decimal-pad"
                    onChangeText={v => setUnits(prev => prev.map(x => (x.key === u.key ? { ...x, factorText: v } : x)))}
                  />
                </View>
                <View style={{ width: 110 }}>
                  <Field
                    label={u.kind === 'sale' ? t('derivedPrice') : t('cost')}
                    value={
                      u.kind === 'sale' && !u.priceText && parsedPrice !== null
                        ? (deriveUnitPrice(parsedPrice, Math.round(Number(u.factorText || 0) * 1_000_000)) / MONEY_SCALE).toString()
                        : u.priceText
                    }
                    editable={u.kind === 'sale'}
                    keyboardType="decimal-pad"
                    onChangeText={v => setUnits(prev => prev.map(x => (x.key === u.key ? { ...x, priceText: v } : x)))}
                  />
                </View>
                <Button
                  title="✕"
                  small
                  variant="ghost"
                  onPress={() => setUnits(prev => prev.filter(x => x.key !== u.key))}
                />
              </View>
            ))
          )}
        </Card>
      </Section>

      {preview.length > 0 && parsedPrice !== null ? (
        <Card>
          <Text style={styles.heading}>{t('derivedPrice')}</Text>
          {preview.map(u => {
            const factorMicro = Math.round(Number(u.factorText || 0) * 1_000_000);
            const price = deriveUnitPrice(parsedPrice, factorMicro);
            const margin = marginPreview({
              unitCostPaisa: Math.round(parsedPrice * 0.8),
              factorMicro,
              baseSellPricePaisa: parsedPrice,
            });
            return (
              <Row
                key={u.key}
                label={`1 ${u.unitCode} = ${u.factorText} ${baseUnit}`}
                value={`${f.moneyPlain(price)} (${t('margin')} ${(margin.marginBp / 100).toFixed(1)}%)`}
              />
            );
          })}
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={saving ? t('saving') : t('save')} onPress={save} loading={saving} />
      {productId ? (
        <View style={{ marginTop: spacing.md }}>
          <Button
            title={t('archive')}
            variant="danger"
            onPress={() =>
              Alert.alert(t('archive'), nameEn, [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('archive'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const { setProductActive } = await import('../../services/productService');
                      await setProductActive(db, { id: productId, active: false, actor });
                      navigation.goBack();
                    } catch (e) {
                      setError(messageOf(e));
                    }
                  },
                },
              ])
            }
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  unitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  muted: { color: colors.muted, fontSize: font.sm },
  error: { color: colors.danger, marginBottom: spacing.md, fontWeight: '600' },
});
