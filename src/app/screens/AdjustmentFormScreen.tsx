import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Field, ModalSheet, Pill, Screen, Section } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useActor, useDb } from '../store/appStore';
import { ADJUSTMENT_TYPES, createAdjustment, type AdjustmentType } from '../../services/adjustmentService';
import { listProducts } from '../../services/productService';
import { parseMoney, parseQty } from '../../core/money';
import { messageOf } from '../../core/errors';
import { showToast } from '../toast';
import type { ProductRow } from '../../db/types';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Draft {
  key: string;
  productId: string;
  name: string;
  baseUnit: string;
  stockMicro: number;
  qtyText: string;
  countedText: string;
  costText: string;
}

let counter = 0;

export default function AdjustmentFormScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const actor = useActor();
  const { t, lang } = useI18n();
  const f = useFormat();
  const [type, setType] = useState<AdjustmentType>('count');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Draft[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(async () => {
      setResults(await listProducts(db, { query: query.trim(), limit: 25 }));
    }, 200);
    return () => clearTimeout(id);
  }, [db, query]);

  const addProduct = (product: ProductRow) => {
    setLines(prev => [
      ...prev,
      {
        key: `a${(counter += 1)}`,
        productId: product.id,
        name: product.name_en,
        baseUnit: product.base_unit,
        stockMicro: Number(product.stock_micro),
        qtyText: '',
        countedText: '',
        costText: (Number(product.cost_paisa) / 100).toString(),
      },
    ]);
    setPickerOpen(false);
    setQuery('');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = lines.map(line => ({
        productId: line.productId,
        unitCode: line.baseUnit,
        qtyMicro: type === 'count' ? undefined : parseQty(line.qtyText || '0'),
        countedQtyMicro: type === 'count' ? parseQty(line.countedText || '0') : undefined,
        unitCostPaisa: parseMoney(line.costText || '0'),
      }));
      await createAdjustment(db, { type, reason, notes: notes || null, lines: payload, actor });
      showToast(t('toastAdded'));
      navigation.goBack();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Card>
        <Text style={styles.label}>{t('stockAdjust')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {ADJUSTMENT_TYPES.map(item => (
            <Pill key={item.type} label={lang === 'ur' ? item.ur : item.en} selected={type === item.type} onPress={() => setType(item.type)} />
          ))}
        </ScrollView>
        <Field label={`${t('reason')} *`} value={reason} onChangeText={setReason} placeholder={t('reason')} />
        <Field label={t('notes')} value={notes} onChangeText={setNotes} multiline />
        <Text style={styles.hint}>
          {lang === 'ur'
            ? 'سپلائر سے اسٹاک وصولی جس پر واجب الادا بنتا ہے، خریداری کے طور پر درج کریں'
            : 'Supplier stock that creates a payable must be recorded as a purchase (this screen never creates supplier debt).'}
        </Text>
      </Card>

      <Section title={t('products')} action={<Button title={`+ ${t('add')}`} small variant="secondary" onPress={() => setPickerOpen(true)} />}>
        {lines.length === 0 ? (
          <Card>
            <Text style={styles.hint}>{t('empty')}</Text>
          </Card>
        ) : (
          lines.map(line => (
            <Card key={line.key}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.lineTitle}>{line.name}</Text>
                <Pressable onPress={() => setLines(prev => prev.filter(l => l.key !== line.key))}>
                  <Text style={{ color: colors.danger, fontWeight: '700' }}>✕</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                {t('stock')}: {f.qty(line.stockMicro, line.baseUnit)}
              </Text>
              {type === 'count' ? (
                <Field
                  label={`${t('quantity')} — counted (${line.baseUnit})`}
                  value={line.countedText}
                  onChangeText={v => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, countedText: v } : l)))}
                  keyboardType="decimal-pad"
                />
              ) : (
                <Field
                  label={`${t('quantity')} (${line.baseUnit})${type === 'correction' ? ' +/-' : ''}`}
                  value={line.qtyText}
                  onChangeText={v => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, qtyText: v } : l)))}
                  keyboardType="decimal-pad"
                />
              )}
              {type === 'opening' || type === 'found' ? (
                <Field
                  label={`${t('cost')} / ${line.baseUnit}`}
                  value={line.costText}
                  onChangeText={v => setLines(prev => prev.map(l => (l.key === line.key ? { ...l, costText: v } : l)))}
                  keyboardType="decimal-pad"
                />
              ) : null}
            </Card>
          ))
        )}
      </Section>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={busy ? t('saving') : t('save')} onPress={save} loading={busy} />

      <ModalSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t('products')}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search')}
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
        <ScrollView style={{ maxHeight: 400 }}>
          {results.map(product => (
            <Pressable key={product.id} style={styles.pickRow} onPress={() => addProduct(product)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineTitle}>{product.name_en}</Text>
                <Text style={styles.hint}>{f.qty(Number(product.stock_micro), product.base_unit)}</Text>
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
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  lineTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, flex: 1 },
  hint: { fontSize: font.xs, color: colors.muted, marginBottom: spacing.xs },
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
