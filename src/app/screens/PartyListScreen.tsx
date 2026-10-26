import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, EmptyState, ErrorView, LoadingView, Pill, useInsets } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useDb } from '../store/appStore';
import { listParties, partyCursor } from '../../services/partyService';
import type { PartyRow } from '../../db/types';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'PartyList'>;

export default function PartyListScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const db = useDb();
  const { t } = useI18n();
  const insets = useInsets();
  const f = useFormat();
  const partyType = route.params.partyType;

  const [query, setQuery] = useState('');
  const [onlyDues, setOnlyDues] = useState(false);
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [cursor, setCursor] = useState<{ after: string; afterId: string } | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (reset: boolean) => {
      if (reset) {setLoading(true);}
      try {
        const page = await listParties(db, partyType, {
          query: query.trim() || undefined,
          onlyWithBalance: onlyDues,
          limit: 30,
          cursor: reset ? null : cursor,
        });
        setRows(prev => (reset ? page : [...prev, ...page]));
        setCursor(partyCursor(page));
        setDone(page.length < 30);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [cursor, db, onlyDues, partyType, query],
  );

  useEffect(() => {
    const id = setTimeout(() => void load(true), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, onlyDues]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [partyType]),
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`${t('search')} — ${t('name')} / ${t('phone')}`}
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Pill label={t('all')} selected={!onlyDues} onPress={() => setOnlyDues(false)} />
          <Pill label={t('balance')} selected={onlyDues} onPress={() => setOnlyDues(true)} />
        </View>
      </View>

      {loading && !rows.length ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={error} onRetry={() => load(true)} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 96 }}
          onEndReached={() => !done && load(false)}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              action={
                <Button
                  title={partyType === 'customer' ? t('addCustomer') : t('addSupplier')}
                  onPress={() => navigation.navigate('PartyForm', { partyType })}
                />
              }
            />
          }
          renderItem={({ item }) => {
            const balance = Number(item.balance_paisa);
            return (
              <Pressable
                style={styles.row}
                onPress={() => navigation.navigate('PartyDetail', { partyType, partyId: item.id })}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name_en}</Text>
                  {item.name_ur ? <Text style={styles.sub}>{item.name_ur}</Text> : null}
                  <Text style={styles.sub}>{item.phone ?? '—'}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[styles.balance, balance > 0 && { color: colors.danger }]}>
                    {f.moneyPlain(Math.abs(balance))}
                  </Text>
                  {balance > 0 ? (
                    <Badge text={partyType === 'customer' ? `${t('owes')}` : `${t('youOwe')}`} tone="warning" />
                  ) : balance < 0 ? (
                    <Badge text={partyType === 'customer' ? t('credit') : t('paid')} tone="success" />
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable style={[styles.fab, { bottom: spacing.lg + insets.bottom }]} onPress={() => navigation.navigate('PartyForm', { partyType })}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
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
  name: { fontSize: font.md, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.xs, color: colors.muted },
  balance: { fontSize: font.md, fontWeight: '800', color: colors.text },
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
