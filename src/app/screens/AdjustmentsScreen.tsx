import React, { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, EmptyState, ErrorView, LoadingView } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useDb } from '../store/appStore';
import { listAdjustments } from '../../services/adjustmentService';
import type { RootStackParamList } from '../navigationTypes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function AdjustmentsScreen() {
  const navigation = useNavigation<Nav>();
  const db = useDb();
  const { t } = useI18n();
  const f = useFormat();
  const state = useAsync(() => listAdjustments(db), []);
  const reload = state.reload;

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <View style={styles.container}>
      {state.loading && !state.data ? (
        <LoadingView />
      ) : state.error ? (
        <ErrorView message={state.error} onRetry={reload} />
      ) : (
        <FlatList
          data={(state.data ?? []) as unknown as Record<string, string | number>[]}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 96 }}
          ListEmptyComponent={<EmptyState />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{String(item.doc_no)}</Text>
                <Text style={styles.sub}>
                  {String(item.type)} · {f.dateTime(String(item.adjusted_at))}
                </Text>
                <Text style={styles.sub}>
                  {String(item.reason)} · {String(item.line_count)} {t('products')}
                </Text>
              </View>
              <Text style={styles.value}>{f.moneyPlain(Number(item.total_cost_paisa))}</Text>
            </View>
          )}
        />
      )}
      <View style={styles.footer}>
        <Button title={`+ ${t('stockAdjust')}`} onPress={() => navigation.navigate('AdjustmentForm')} />
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
  value: { fontSize: font.md, fontWeight: '700', color: colors.text },
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
