import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { Badge, Button, Card, ErrorView, LoadingView, Row, Screen, Section } from '../components';
import { colors, font, spacing } from '../theme';
import { useI18n } from '../i18n';
import { useFormat } from '../format';
import { useAsync } from '../useAsync';
import { useActor, useDb } from '../store/appStore';
import {
  createBackup,
  formatBytes,
  lastBackup,
  precheckBackup,
  restoreBackup,
  type BackupTarget,
} from '../../services/backupService';
import { backupHistory } from '../../services/backupService';
import { NativeBackupTarget } from '../../native/bridge';
import { LATEST_SCHEMA_VERSION } from '../../db/schema';
import { messageOf } from '../../core/errors';
import { can } from '../../core/permissions';

const target: BackupTarget = new NativeBackupTarget();

export default function BackupScreen() {
  const db = useDb();
  const actor = useActor();
  const { t, lang } = useI18n();
  const f = useFormat();
  const [encrypt, setEncrypt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<string | null>(null);

  const state = useAsync(async () => {
    const history = await backupHistory(db);
    const files = await target.list();
    const last = await lastBackup(db);
    return { history, files, last };
  }, []);

  const reload = state.reload;

  const doBackup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const record = await createBackup(db, target, { encrypt, actor });
      setMessage(`${t('createBackup')} ✓ ${formatBytes(record.sizeBytes)}`);
      await reload();
    } catch (e) {
      setMessage(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (path: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const check = await precheckBackup(target, path, LATEST_SCHEMA_VERSION);
      if (!check.ok) {throw new Error(check.message);}
      Alert.alert(t('restoreBackup'), `${check.message}\n\nReplace current data?`, [
        { text: t('cancel'), style: 'cancel', onPress: () => setBusy(false) },
        {
          text: t('confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await restoreBackup(db, target, { path, actor, supportedVersion: LATEST_SCHEMA_VERSION });
              setMessage(`${t('restoreBackup')} ✓`);
              await reload();
            } catch (e) {
              setMessage(messageOf(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]);
    } catch (e) {
      setMessage(messageOf(e));
      setBusy(false);
    }
  };

  const checkIntegrity = async () => {
    setBusy(true);
    try {
      setIntegrity(await db.integrityCheck());
    } catch (e) {
      setIntegrity(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (state.loading && !state.data) {return <LoadingView />;}
  if (state.error) {return <ErrorView message={state.error} onRetry={reload} />;}
  const { history, files, last } = state.data!;

  return (
    <Screen scroll refreshing={state.loading} onRefresh={reload}>
      <Card>
        <Text style={styles.title}>{t('backup')}</Text>
        <Row
          label={t('lastBackup')}
          value={last ? `${f.dateTime(last.createdAt)} · ${formatBytes(last.sizeBytes)}` : '—'}
          tone={last ? 'default' : 'danger'}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{t('encryptBackup')}</Text>
          <Switch value={encrypt} onValueChange={setEncrypt} trackColor={{ true: colors.primary }} />
        </View>
        <Button title={busy ? t('saving') : t('createBackup')} onPress={doBackup} loading={busy} disabled={!can(actor.role, 'backup.manage')} />
        <Text style={styles.hint}>{t('backupCaution')}</Text>
      </Card>

      <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
        <Text style={{ color: colors.warning, fontSize: font.sm }}>
          {lang === 'ur'
            ? 'انکرپٹڈ بیک اپ کی کلید صرف اسی فون کے Keystore میں ہے۔ فون گم ہو تو بیک اپ کھل نہیں سکے گا۔'
            : 'Encrypted backup keys live in this phone’s Keystore. If the phone is lost, the encrypted backup cannot be opened. Keep unencrypted exports somewhere safe.'}
        </Text>
      </Card>

      <Section title={t('backup')}>
        {history.length === 0 ? <Card><Text style={styles.hint}>{t('empty')}</Text></Card> : null}
        {history.map(record => (
          <Card key={record.id}>
            <Row label={f.dateTime(record.createdAt)} value={formatBytes(record.sizeBytes)} />
            <Text style={styles.hint} numberOfLines={1}>
              {record.path}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.sm }}>
              <Badge text={record.encrypted ? 'encrypted' : 'plain'} tone={record.encrypted ? 'info' : 'default'} />
              <Badge text={record.status} tone="success" />
              <Button title={t('share')} small variant="secondary" onPress={() => void target.share(record.path)} />
              <Button title={t('restore')} small variant="secondary" onPress={() => doRestore(record.path)} />
            </View>
          </Card>
        ))}
      </Section>

      <Section title={t('integrityCheck')}>
        <Card>
          <Button title={t('integrityCheck')} variant="secondary" onPress={checkIntegrity} />
          {integrity ? <Text style={styles.hint}>{integrity}</Text> : null}
        </Card>
      </Section>

      {files.length > 0 ? (
        <Section title="Files on device">
          <Card>
            {files.map(file => (
              <Row key={file.path} label={file.name} value={formatBytes(file.size)} />
            ))}
          </Card>
        </Section>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: font.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  hint: { fontSize: font.xs, color: colors.muted, marginTop: spacing.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  switchLabel: { fontSize: font.sm, color: colors.text },
  message: { color: colors.primary, fontWeight: '600', marginBottom: spacing.md },
});
