import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Badge, Button, EmptyState, ErrorView, LoadingView } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useDb } from '../store/appStore';
import { listPurchases } from '../../services/purchaseService';
import type { PurchaseRow } from '../../db/types';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function PurchasesScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const { t } = useI18n();
  const f = useFormat();
  const [rows, setRows] = useState<(PurchaseRow & { line_count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPurchases(db, { limit: 50 }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading && !rows.length) {return <LoadingView />;}
  if (error) {return <ErrorView message={error} onRetry={load} />;}

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 90 }}
        ListEmptyComponent={<EmptyState message={t('empty')} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate('PurchaseDetail', { purchaseId: item.id })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.doc_no}</Text>
              <Text style={styles.sub}>
                {item.supplier_name ?? t('none')} · {f.date(item.purchased_at)}
              </Text>
              <Text style={styles.sub}>
                {item.line_count} {t('products')} · {t('paid')} {f.moneyPlain(Number(item.paid_paisa))}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={styles.total}>{f.moneyPlain(Number(item.total_paisa))}</Text>
              {item.status !== 'posted' ? (
                <Badge text={item.status} tone="danger" />
              ) : Number(item.total_paisa) > Number(item.paid_paisa) ? (
                <Badge text={t('payable')} tone="warning" />
              ) : (
                <Badge text={t('paid')} tone="success" />
              )}
            </View>
          </Pressable>
        )}
      />
      <View style={styles.footer}>
        <Button title={`+ ${t('newPurchase')}`} onPress={() => navigation.navigate('PurchaseForm')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
