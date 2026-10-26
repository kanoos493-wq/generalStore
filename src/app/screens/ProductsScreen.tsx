import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, EmptyState, ErrorView, LoadingView, Pill } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useDb } from '../store/appStore';
import { listProducts, nextCursor, type ProductSort, type StockFilter } from '../../services/productService';
import type { ProductRow } from '../../db/types';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProductsScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const { t } = useI18n();
  const f = useFormat();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [stock, setStock] = useState<StockFilter>('all');
  const [sort, setSort] = useState<ProductSort>('name');
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [cursor, setCursor] = useState<{ after: string | number | null; afterId: string | null } | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listProducts(db, { query: debounced, stock, sort, limit: 30 });
      setRows(page);
      setCursor(nextCursor(page, sort));
      setDone(page.length < 30);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [db, debounced, sort, stock]);

  useFocusEffect(
    useCallback(() => {
      void loadFirst();
    }, [loadFirst]),
  );

  const loadMore = async () => {
    if (loadingMore || done || !cursor) {return;}
    setLoadingMore(true);
    try {
      const page = await listProducts(db, { query: debounced, stock, sort, limit: 30, cursor });
      setRows(prev => [...prev, ...page.filter(p => !prev.some(x => x.id === p.id))]);
      setCursor(nextCursor(page, sort));
      setDone(page.length < 30);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const stockFilters: { value: StockFilter; label: string }[] = [
    { value: 'all', label: t('all') },
    { value: 'in', label: t('inStock') },
    { value: 'low', label: t('lowStock') },
    { value: 'out', label: t('outOfStock') },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`${t('search')} — ${t('name')} / ${t('barcode')}`}
          placeholderTextColor={colors.faint}
          style={styles.search}
          autoCorrect={false}
        />
        <View style={styles.filters}>
          {stockFilters.map(item => (
            <Pill key={item.value} label={item.label} selected={stock === item.value} onPress={() => setStock(item.value)} />
          ))}
        </View>
        <View style={styles.filters}>
          {(
            [
              ['name', t('name')],
              ['stock', t('stock')],
              ['price', t('price')],
              ['recent', t('date')],
            ] as [ProductSort, string][]
          ).map(([value, label]) => (
            <Pill key={value} label={label} selected={sort === value} onPress={() => setSort(value)} />
          ))}
        </View>
      </View>

      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={error} onRetry={loadFirst} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 96 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              message={`${t('empty')} — ${t('addProduct')}`}
              action={<Button title={t('addProduct')} onPress={() => navigation.navigate('ProductForm')} />}
            />
          }
          ListFooterComponent={loadingMore ? <LoadingView /> : null}
          renderItem={({ item }) => {
            const out = Number(item.stock_micro) <= 0;
            const low = !out && Number(item.stock_micro) <= Number(item.min_stock_micro);
            return (
              <Pressable
                onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name_en}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {item.name_ur ? `${item.name_ur} · ` : ''}
                    {item.code}
                    {item.barcode ? ` · ${item.barcode}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={styles.price}>{f.moneyPlain(Number(item.sale_price_paisa))}</Text>
                  <Text style={[styles.sub, out && { color: colors.danger }]}>
                    {f.qty(Number(item.stock_micro), item.base_unit)}
                  </Text>
                  {out ? <Badge text={t('outOfStock')} tone="danger" /> : low ? <Badge text={t('lowStock')} tone="warning" /> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable style={styles.fab} onPress={() => navigation.navigate('ProductForm')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, backgroundColor: colors.bg, gap: spacing.sm },
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  name: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted },
  price: { fontSize: font.md, fontWeight: '700', color: colors.text },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: { color: colors.onPrimary, fontSize: 28, fontWeight: '700', lineHeight: 32 },
});
