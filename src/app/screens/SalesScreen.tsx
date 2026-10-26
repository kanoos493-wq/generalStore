import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, EmptyState, ErrorView, LoadingView, Pill } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useDb } from '../store/appStore';
import { listSales, type SaleListRow } from '../../services/salesService';
import { rangeForPreset, type DateRange } from '../../core/dates';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Preset = 'today' | 'week' | 'month' | 'all';

export default function SalesScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const { t } = useI18n();
  const f = useFormat();
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('today'));
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SaleListRow[]>([]);
  const [cursor, setCursor] = useState<SaleListRow | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (reset: boolean) => {
      if (reset) {setLoading(true);} else {setLoadingMore(true);}
      setError(null);
      try {
        const page = await listSales(db, {
          from: preset === 'all' ? undefined : range.from,
          to: preset === 'all' ? undefined : range.to,
          query: query.trim() || undefined,
          limit: 30,
          beforeSoldAt: reset ? undefined : cursor?.sold_at,
          beforeId: reset ? undefined : cursor?.id,
        });
        setRows(prev => (reset ? page : [...prev, ...page]));
        setCursor(page.length ? page[page.length - 1] : null);
        setDone(page.length < 30);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [db, preset, query, range.from, range.to, cursor?.id, cursor?.sold_at],
  );

  useFocusEffect(
    useCallback(() => {
      void load(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preset, range.from, range.to]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load(true)}
          placeholder={`${t('search')} — ${t('invoices')}`}
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {(
            [
              ['today', t('today')],
              ['week', t('thisWeek')],
              ['month', t('thisMonth')],
              ['all', t('all')],
            ] as [Preset, string][]
          ).map(([value, label]) => (
            <Pill
              key={value}
              label={label}
              selected={preset === value}
              onPress={() => {
                setPreset(value);
                setRange(rangeForPreset(value === 'all' ? 'all' : value));
              }}
            />
          ))}
        </View>
      </View>

      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load(true)} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md }}
          onEndReached={() => !done && !loadingMore && load(false)}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={<EmptyState message={t('empty')} />}
          ListFooterComponent={loadingMore ? <LoadingView /> : null}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => navigation.navigate('SaleDetail', { saleId: item.id })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{item.invoice_no}</Text>
                <Text style={styles.sub}>
                  {item.customer_name ?? t('walkIn')} · {f.dateTime(item.sold_at)}
                </Text>
                <Text style={styles.sub}>
                  {item.line_count} {t('products')} · {t('paid')} {f.moneyPlain(Number(item.paid_paisa))}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.total}>{f.moneyPlain(Number(item.total_paisa))}</Text>
                {item.status === 'reversed' ? (
                  <Badge text={item.status} tone="danger" />
                ) : Number(item.credit_paisa) > 0 ? (
                  <Badge text={`${t('credit')} ${f.moneyPlain(Number(item.credit_paisa))}`} tone="warning" />
                ) : (
                  <Badge text={item.status} tone="success" />
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.md, gap: spacing.sm },
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
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted },
  total: { fontSize: font.md, fontWeight: '800', color: colors.text },
});
