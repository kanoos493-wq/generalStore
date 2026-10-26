import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorView, Field, LoadingView, ModalSheet, Row, Screen, Section } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useActor, useDb } from '../store/appStore';
import {
  cashMovementsForShift,
  closeShift,
  currentShiftSummary,
  manualCashMovement,
  openShift,
  shiftHistory,
} from '../../services/cashService';
import { parseMoney } from '../../core/money';
import { messageOf } from '../../core/errors';
import { can } from '../../core/permissions';

export default function CashClosingScreen() {
  const db = useDb();
  const actor = useActor();
  const { t } = useI18n();
  const f = useFormat();
  const [error, setError] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDirection, setMoveDirection] = useState<'in' | 'out'>('in');
  const [moveAmount, setMoveAmount] = useState('');
  const [moveNote, setMoveNote] = useState('');

  const state = useAsync(async () => {
    const summary = await currentShiftSummary(db);
    const history = await shiftHistory(db, 20);
    const movements = summary.shiftId ? await cashMovementsForShift(db, summary.shiftId) : [];
    return { summary, history, movements };
  }, []);

  const reload = state.reload;

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await reload();
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={reload} />;}
  if (!state.data) {return <LoadingView />;}
  const { summary, history, movements } = state.data;
  const expected = summary.expectedPaisa;
  const countedPaisa = (() => {
    try {
      return parseMoney(counted || '0');
    } catch {
      return 0;
    }
  })();

  return (
    <Screen scroll refreshing={state.loading} onRefresh={reload}>
      <Card>
        <Text style={styles.title}>{t('cashClosing')}</Text>
        <Text style={styles.sub}>{summary.shiftId ? `${t('openShift')} ${summary.shiftId.slice(-6)}` : t('none')}</Text>
        <Row label={t('openingCash')} value={f.moneyPlain(summary.openingPaisa)} />
        <Row label={t('cashIn')} value={f.moneyPlain(summary.inflowPaisa)} tone="success" />
        <Row label={t('cashOut')} value={f.moneyPlain(summary.outflowPaisa)} tone="danger" />
        <Row label={t('expectedCash')} value={f.moneyPlain(expected)} bold />
        <Text style={styles.hint}>
          expected = {t('openingCash')} + {t('cashIn')} − {t('cashOut')} · digital payments are excluded
        </Text>
      </Card>

      {!summary.shiftId ? (
        <Card>
          <Text style={styles.title}>{t('openShift')}</Text>
          <Field label={t('openingCash')} value={opening} onChangeText={setOpening} keyboardType="decimal-pad" />
          <Button
            title={busy ? t('saving') : t('openShift')}
            loading={busy}
            onPress={() => run(() => openShift(db, { openingCashPaisa: parseMoney(opening || '0'), actor }))}
          />
        </Card>
      ) : (
        <>
          <Card>
            <Text style={styles.title}>{t('countedCash')}</Text>
            <Field label={t('countedCash')} value={counted} onChangeText={setCounted} keyboardType="decimal-pad" />
            <Field label={t('notes')} value={notes} onChangeText={setNotes} />
            <Row
              label={t('difference')}
              value={f.moneyPlain(countedPaisa - expected)}
              tone={countedPaisa === expected ? 'success' : 'danger'}
            />
            <Button
              title={busy ? t('saving') : t('closeShift')}
              loading={busy}
              disabled={!can(actor.role, 'cash.close')}
              onPress={() =>
                run(async () => {
                  await closeShift(db, { countedPaisa, notes: notes || undefined, actor });
                  setCounted('');
                  setNotes('');
                })
              }
            />
          </Card>

          <Section title={t('cashIn') + ' / ' + t('cashOut')}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title={t('ownerDeposit')} variant="secondary" style={{ flex: 1 }} onPress={() => { setMoveDirection('in'); setMoveOpen(true); }} />
              <Button title={t('ownerWithdrawal')} variant="secondary" style={{ flex: 1 }} onPress={() => { setMoveDirection('out'); setMoveOpen(true); }} />
            </View>
          </Section>

          <Section title={t('movements')}>
            <Card>
              {(movements as unknown as { id: string; direction: string; amount_paisa: number; description: string; moved_at: string }[]).map(m => (
                <Row
                  key={m.id}
                  label={`${m.description} · ${f.time(m.moved_at)}`}
                  value={`${m.direction === 'in' ? '+' : '-'}${f.moneyPlain(Number(m.amount_paisa))}`}
                  tone={m.direction === 'in' ? 'success' : 'danger'}
                />
              ))}
              {movements.length === 0 ? <Text style={styles.hint}>{t('empty')}</Text> : null}
            </Card>
          </Section>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Section title={t('shiftHistory')}>
        <Card>
          {(history as unknown as { id: string; opened_at: string; closed_at: string | null; counted_cash_paisa: number | null; difference_paisa: number | null; sales_count: number }[]).map(s => (
            <View key={s.id} style={{ marginBottom: spacing.sm }}>
              <Row
                label={`${f.dateTime(s.opened_at)} → ${s.closed_at ? f.time(s.closed_at) : '—'}`}
                value={s.counted_cash_paisa === null ? '—' : f.moneyPlain(Number(s.counted_cash_paisa))}
              />
              <Text style={styles.hint}>
                {Number(s.sales_count)} {t('invoices')} · {t('difference')}{' '}
                {s.difference_paisa === null ? '—' : f.moneyPlain(Number(s.difference_paisa))}
              </Text>
            </View>
          ))}
          {history.length === 0 ? <Text style={styles.hint}>{t('empty')}</Text> : null}
        </Card>
      </Section>

      <ModalSheet
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={moveDirection === 'in' ? t('ownerDeposit') : t('ownerWithdrawal')}
        footer={
          <Button
            title={busy ? t('saving') : t('save')}
            loading={busy}
            onPress={() =>
              run(async () => {
                await manualCashMovement(db, {
                  direction: moveDirection,
                  amountPaisa: parseMoney(moveAmount || '0'),
                  description: moveNote || (moveDirection === 'in' ? 'Owner deposit' : 'Owner withdrawal'),
                  actor,
                });
                setMoveOpen(false);
                setMoveAmount('');
                setMoveNote('');
              })
            }
          />
        }>
        <Field label={t('amount')} value={moveAmount} onChangeText={setMoveAmount} keyboardType="decimal-pad" />
        <Field label={t('notes')} value={moveNote} onChangeText={setMoveNote} />
      </ModalSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  sub: { fontSize: font.xs, color: colors.muted, marginBottom: spacing.sm },
  hint: { fontSize: font.xs, color: colors.muted },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.md },
});
