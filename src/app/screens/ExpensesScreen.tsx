import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, EmptyState, ErrorView, Field, LoadingView, ModalSheet, Row, SelectField } from '../components';
import { colors, font, radius, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useActor, useDb } from '../store/appStore';
import { createExpense, expenseCategories, listExpenses, voidExpense } from '../../services/expenseService';
import { paymentMethods } from '../../services/paymentService';
import { parseMoney } from '../../core/money';
import { messageOf } from '../../core/errors';
import { can } from '../../core/permissions';
import { rangeForPreset } from '../../core/dates';

export default function ExpensesScreen() {
  const db = useDb();
  const actor = useActor();
  const { t } = useI18n();
  const f = useFormat();
  const [rows, setRows] = useState<Record<string, string | number | null>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [methods, setMethods] = useState<{ value: string; label: string }[]>([]);
  const [categoryId, setCategoryId] = useState('exp_misc');
  const [methodId, setMethodId] = useState('pm_cash');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await listExpenses(db, { limit: 80 })) as unknown as Record<string, string | number | null>[]);
      const cats = await expenseCategories(db);
      setCategories(cats.map(c => ({ value: String(c.id), label: String(c.name_en) })));
      const pm = await paymentMethods(db);
      setMethods(pm.filter(m => !m.is_credit).map(m => ({ value: m.id, label: m.name_en })));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await createExpense(db, {
        categoryId,
        description,
        amountPaisa: parseMoney(amount || '0'),
        methodId,
        payee: payee || null,
        actor,
      });
      setOpen(false);
      setDescription('');
      setAmount('');
      setPayee('');
      await load();
    } catch (e) {
      setFormError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const total = rows.reduce((sum, r) => sum + Number(r.amount_paisa ?? 0), 0);

  return (
    <View style={styles.container}>
      {loading && !rows.length ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={error} onRetry={load} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 96 }}
          ListHeaderComponent={
            <Card>
              <Row label={t('expenses')} value={f.money(total)} bold />
              <Text style={styles.sub}>
                {f.date(rangeForPreset('month').from)} → {f.date(new Date().toISOString())}
              </Text>
            </Card>
          }
          ListEmptyComponent={<EmptyState />}
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => {
                if (!can(actor.role, 'settings.manage')) {return;}
                Alert.alert(t('confirm'), `${t('delete')} ${item.doc_no}?`, [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('confirm'),
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await voidExpense(db, { expenseId: String(item.id), reason: 'Voided by manager', actor });
                        await load();
                      } catch (e) {
                        setError(messageOf(e));
                      }
                    },
                  },
                ]);
              }}
              style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{String(item.description)}</Text>
                <Text style={styles.sub}>
                  {String(item.category_name)} · {String(item.method_name)} · {f.dateTime(String(item.spent_at))}
                </Text>
              </View>
              <Text style={styles.value}>{f.moneyPlain(Number(item.amount_paisa))}</Text>
            </Pressable>
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={() => setOpen(true)}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>

      <ModalSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('addExpense')}
        footer={<Button title={busy ? t('saving') : t('save')} onPress={submit} loading={busy} />}>
        <SelectField label={t('category')} value={categoryId} options={categories} onChange={setCategoryId} />
        <Field label={`${t('name')} / ${t('notes')}`} value={description} onChangeText={setDescription} />
        <Field label={t('amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <SelectField label={t('paymentMethod')} value={methodId} options={methods} onChange={setMethodId} />
        <Field label={`${t('payee')} (${t('optional')})`} value={payee} onChangeText={setPayee} />
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
      </ModalSheet>
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
  error: { color: colors.danger, fontWeight: '600' },
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
