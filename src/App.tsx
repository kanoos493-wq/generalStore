import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, font, spacing } from './app/theme';
import { ErrorView, LoadingView } from './app/components';
import { attachAppStateListener, useAppStore } from './app/store/appStore';
import LockScreen from './app/screens/LockScreen';
import Navigation from './app/navigation';
import { useI18n } from './app/i18n';

export default function App() {
  const initialize = useAppStore(s => s.initialize);
  const ready = useAppStore(s => s.ready);
  const bootError = useAppStore(s => s.bootError);
  const locked = useAppStore(s => s.locked);
  const language = useAppStore(s => s.language);

  useEffect(() => {
    void initialize();
    const detach = attachAppStateListener();
    const interval = setInterval(() => {
      if (useAppStore.getState().shouldAutoLock()) {
        useAppStore.getState().lock();
      }
    }, 5000);
    return () => {
      detach();
      clearInterval(interval);
    };
  }, [initialize]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <View style={styles.root} key={language}>
        {bootError ? (
          <ErrorView message={bootError} onRetry={() => void initialize()} />
        ) : !ready ? (
          <LoadingView />
        ) : locked ? (
          <LockScreen />
        ) : (
          <Navigation />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});

export function StartupError({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
      <Text style={{ fontSize: font.md, color: colors.danger, fontWeight: '700' }}>{t('error')}</Text>
      <Text style={{ fontSize: font.sm, color: colors.muted, marginTop: spacing.sm, textAlign: 'center' }}>{message}</Text>
    </View>
  );
}
