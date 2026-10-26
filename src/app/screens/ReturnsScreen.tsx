import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Badge, EmptyState, ErrorView, LoadingView } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useDb } from '../store/appStore';
import { listReturns } from '../../services/returnService';

export default function ReturnsScreen() {
  const db = useDb();
  const { t } = useI18n();
  const f = useFormat();
  const state = useAsync(() => listReturns(db, 80), []);

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={state.reload} />;}

  const rows = (state.data ?? []) as unknown as Record<string, string | number | null>[];

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={{ padding: spacing.md }}
        ListEmptyComponent={<EmptyState message={t('empty')} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{String(item.doc_no)}</Text>
              <Text style={styles.sub}>
                {String(item.original_no ?? '')} · {String(item.party_name ?? '')} · {f.dateTime(String(item.returned_at))}
              </Text>
              <Text style={styles.sub}>{String(item.reason ?? '')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={styles.value}>{f.moneyPlain(Number(item.total_paisa))}</Text>
              <Badge text={String(item.type)} tone={item.type === 'sale' ? 'warning' : 'info'} />
            </View>
          </View>
        )}
      />
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
  value: { fontSize: font.md, fontWeight: '800', color: colors.text },
});
