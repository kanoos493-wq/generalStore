/**
 * Toast host — mounted once in App, above the navigation tree.
 *
 * Renders the current toast from `useToastStore`, animates it in, and auto
 * dismisses. Positioned above the system navigation inset so it is never
 * hidden behind the Android gesture/three-button bar.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, spacing } from './theme';
import { useToastStore } from './toast';

const VISIBLE_MS = 2200;

export default function ToastHost() {
  const insets = useSafeAreaInsets();
  const message = useToastStore(s => s.message);
  const tone = useToastStore(s => s.tone);
  const seq = useToastStore(s => s.seq);
  const hide = useToastStore(s => s.hide);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-animate on every new toast (seq changes even for identical text).
  useEffect(() => {
    if (!message) {
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
    ]).start();

    if (timer.current) {clearTimeout(timer.current);}
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) {hide();}
        },
      );
    }, VISIBLE_MS);

    return () => {
      if (timer.current) {clearTimeout(timer.current);}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, message]);

  if (!message) {return null;}

  const background =
    tone === 'error' ? colors.danger : tone === 'info' ? colors.info : colors.success;

  return (
    <Animated.View
      accessibilityRole="alert"
      pointerEvents="none"
      style={[
        styles.toast,
        // Static layout/colour, kept separate from the animated values so the
        // style type infers cleanly.
        { backgroundColor: background, bottom: insets.bottom + spacing.xl },
        { opacity, transform: [{ translateY }] },
      ]}>
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    // Elevation so it reads as a transient overlay, not page content.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  text: {
    color: '#FFFFFF',
    fontSize: font.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
});
