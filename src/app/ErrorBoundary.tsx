import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from './theme';

interface Props {
  children: React.ReactNode;
  /** Optional label so the user knows which area failed. */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence against an app that closes itself.
 *
 * React only recovers from a render error if an error boundary catches it;
 * without one, a single throwing component unmounts the whole tree and the
 * process dies — which is exactly the "app auto-closes after setup" symptom.
 * This boundary catches the failure, shows a readable message, and offers a
 * retry that re-mounts the subtree from a clean state.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a breadcrumb in the device log for diagnostics; never throw here.
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.area}>{this.props.area ?? 'The app'}</Text>
        <Text style={styles.message}>{error.message || String(error)}</Text>
        <Text style={styles.hint}>
          Your data is safe. Tap Try again to reload this screen, or restart the app if it keeps
          happening.
        </Text>
        <Text style={styles.retry} onPress={this.reset} accessibilityRole="button">
          Try again
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.danger },
  area: { fontSize: font.sm, color: colors.muted, marginTop: spacing.xs },
  message: {
    fontSize: font.sm,
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  hint: {
    fontSize: font.xs,
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  retry: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    overflow: 'hidden',
    borderRadius: 12,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    fontSize: font.md,
    fontWeight: '800',
  },
});
