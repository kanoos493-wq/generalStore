/** Shared UI primitives: everything the screens are built from. */
import React, { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, radius, spacing, touchTarget } from './theme';
import { useI18n } from './i18n';

/**
 * System-bar insets, read once here so no screen has to hardcode padding for
 * a particular phone. `top` covers the status bar and any cutout; `bottom`
 * covers gesture navigation as well as the three-button bar.
 */
export function useInsets() {
  return useSafeAreaInsets();
}

/**
 * The DukanDost mark, drawn with plain views so it stays crisp at any size and
 * matches the launcher icon and splash screen (assets/branding/logo.svg).
 */
export function BrandMark(props: { size?: number }) {
  const size = props.size ?? 96;
  const basketH = size * 0.3;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="DukanDost"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {/* handle */}
      <View
        style={{
          width: size * 0.28,
          height: size * 0.16,
          borderTopLeftRadius: size * 0.14,
          borderTopRightRadius: size * 0.14,
          borderWidth: size * 0.035,
          borderBottomWidth: 0,
          borderColor: colors.onPrimary,
        }}
      />
      {/* body */}
      <View
        style={{
          width: size * 0.42,
          height: basketH,
          marginTop: -size * 0.02,
          backgroundColor: colors.onPrimary,
          borderRadius: size * 0.03,
          alignItems: 'center',
          justifyContent: 'space-evenly',
          paddingHorizontal: size * 0.06,
        }}>
        <View style={{ width: '100%', height: size * 0.035, backgroundColor: colors.primary, borderRadius: size * 0.017 }} />
        <View style={{ width: '100%', height: size * 0.035, backgroundColor: colors.primary, borderRadius: size * 0.017 }} />
      </View>
    </View>
  );
}

/** True when the user asked Android to remove/reduce animations. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (mounted) {setReduced(!!enabled);}})
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => setReduced(!!enabled));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export function useTextStyle(): TextStyle {
  const { rtl } = useI18n();
  return {
    textAlign: rtl ? 'right' : 'left',
    writingDirection: rtl ? 'rtl' : 'ltr',
  };
}

export function Screen(props: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  footer?: ReactNode;
}) {
  const { children, scroll, refreshing, onRefresh, padded = true, footer } = props;
  const insets = useSafeAreaInsets();
  const scrollStyle = [styles.scrollContent, padded && styles.padded];
  if (scroll) {
    return (
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={scrollStyle}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={{ flex: 1, paddingTop: insets.top }}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            ) : undefined
          }>
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingBottom: insets.bottom }}>{footer}</View> : null}
      </View>
    );
  }
  return (
    <View style={[styles.screen, padded && styles.padded, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {children}
    </View>
  );
}

/** Fixed bottom action bar that stays above the Android navigation area. */
export function BottomBar(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }, props.style]}>
      {props.children}
    </View>
  );
}

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const content = <View style={[styles.card, props.style]}>{props.children}</View>;
  if (!props.onPress) {return content;}
  return (
    <Pressable onPress={props.onPress} android_ripple={{ color: colors.border }}>
      {content}
    </Pressable>
  );
}

export function Section(props: { title?: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, props.style]}>
      {(props.title || props.action) && (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{props.title}</Text>
          {props.action}
        </View>
      )}
      {props.children}
    </View>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const variant = props.variant ?? 'primary';
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.title}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.small && styles.buttonSmall,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || pressed) && { opacity: disabled ? 0.5 : 0.85 },
        props.style,
      ]}>
      {props.loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            props.small && { fontSize: font.sm },
            variant === 'primary' && { color: colors.onPrimary },
            variant === 'secondary' && { color: colors.primary },
            variant === 'danger' && { color: colors.onPrimary },
            variant === 'ghost' && { color: colors.primary },
          ]}>
          {props.title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  error?: string | null;
  hint?: string;
  autoFocus?: boolean;
  editable?: boolean;
  right?: ReactNode;
  testID?: string;
  maxLength?: number;
  secure?: boolean;
}) {
  const textStyle = useTextStyle();
  return (
    <View style={styles.field}>
      {props.label ? <Text style={styles.fieldLabel}>{props.label}</Text> : null}
      <View style={[styles.inputWrap, props.error ? styles.inputError : null]}>
        <TextInput
          testID={props.testID}
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor={colors.faint}
          keyboardType={props.keyboardType}
          multiline={props.multiline}
          autoFocus={props.autoFocus}
          editable={props.editable !== false}
          maxLength={props.maxLength}
          secureTextEntry={props.secure}
          style={[styles.input, textStyle, props.multiline && { minHeight: 72, textAlignVertical: 'top' }]}
        />
        {props.right}
      </View>
      {props.error ? <Text style={styles.fieldError}>{props.error}</Text> : null}
      {!props.error && props.hint ? <Text style={styles.fieldHint}>{props.hint}</Text> : null}
    </View>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

export function SelectField(props: {
  label?: string;
  value?: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string | null;
  disabled?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const { t } = useI18n();
  const selected = props.options.find(o => o.value === props.value);
  return (
    <View style={styles.field}>
      {props.label ? <Text style={styles.fieldLabel}>{props.label}</Text> : null}
      <Pressable
        testID={props.testID}
        disabled={props.disabled}
        onPress={() => setOpen(true)}
        style={[styles.inputWrap, styles.select, props.error ? styles.inputError : null, props.disabled && { opacity: 0.6 }]}>
        <Text style={[styles.selectText, !selected && { color: colors.faint }]} numberOfLines={1}>
          {selected ? selected.label : props.placeholder ?? t('none')}
        </Text>
        <Text style={styles.selectCaret}>▾</Text>
      </Pressable>
      {props.error ? <Text style={styles.fieldError}>{props.error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={props.options}
              keyExtractor={item => item.value}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.optionRow}
                  onPress={() => {
                    props.onChange(item.value);
                    setOpen(false);
                  }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionLabel}>{item.label}</Text>
                    {item.sublabel ? <Text style={styles.optionSub}>{item.sublabel}</Text> : null}
                  </View>
                  {item.value === props.value ? <Text style={{ color: colors.primary }}>✓</Text> : null}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>{t('empty')}</Text>}
              style={{ maxHeight: 420 }}
            />
            <Button title={t('close')} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Touch-first numeric entry, shared by the lock screen and the setup wizard so
 * both look and behave identically (large targets, no keyboard required).
 */
export function PinPad(props: {
  value: string;
  onChange: (value: string) => void;
  minLength?: number;
  maxLength?: number;
  disabled?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const min = props.minLength ?? 4;
  const max = props.maxLength ?? 8;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  const slots = Math.max(min, props.value.length);
  return (
    <View style={pinStyles.wrap} testID={props.testID}>
      <View style={pinStyles.dots}>
        {Array.from({ length: slots }).map((_, i) => (
          <View key={i} style={[pinStyles.dot, i < props.value.length && pinStyles.dotFilled]} />
        ))}
      </View>
      <View style={pinStyles.keypad}>
        {keys.map((key, i) =>
          key === '' ? (
            <View key={i} style={pinStyles.key} />
          ) : (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={key === '⌫' ? t('delete') : key}
              disabled={props.disabled}
              onPress={() => {
                if (props.disabled) {return;}
                if (key === '⌫') {
                  props.onChange(props.value.slice(0, -1));
                } else if (props.value.length < max) {
                  props.onChange(`${props.value}${key}`);
                }
              }}
              style={({ pressed }) => [pinStyles.key, pressed && { backgroundColor: colors.primarySoft }]}>
              <Text style={pinStyles.keyText}>{key}</Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

/** Progress indicator for the setup wizard ("step n of m"). */
export function StepDots(props: { count: number; index: number }) {
  return (
    <View style={pinStyles.steps} accessibilityRole="progressbar">
      {Array.from({ length: props.count }).map((_, i) => (
        <View key={i} style={[pinStyles.step, i === props.index && pinStyles.stepActive]} />
      ))}
    </View>
  );
}

export function Row(props: { label: string; value: string; bold?: boolean; tone?: 'default' | 'danger' | 'success' | 'muted' }) {
  const color =
    props.tone === 'danger' ? colors.danger : props.tone === 'success' ? colors.success : props.tone === 'muted' ? colors.muted : colors.text;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, props.bold && styles.rowLabelBold]}>{props.label}</Text>
      <Text style={[styles.rowValue, { color }, props.bold && styles.rowValueBold]} numberOfLines={2}>
        {props.value}
      </Text>
    </View>
  );
}

export function Kpi(props: { label: string; value: string; sub?: string; tone?: 'default' | 'success' | 'danger' | 'warning' }) {
  const toneColor =
    props.tone === 'success'
      ? colors.success
      : props.tone === 'danger'
        ? colors.danger
        : props.tone === 'warning'
          ? colors.warning
          : colors.text;
  return (
    <View style={styles.kpi}>
      <Text style={styles.kpiLabel} numberOfLines={2}>
        {props.label}
      </Text>
      <Text style={[styles.kpiValue, { color: toneColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {props.value}
      </Text>
      {props.sub ? (
        <Text style={styles.kpiSub} numberOfLines={1}>
          {props.sub}
        </Text>
      ) : null}
    </View>
  );
}

export function Badge({ text, tone = 'default' }: { text: string; tone?: 'default' | 'success' | 'danger' | 'warning' | 'info' }) {
  const bg =
    tone === 'success'
      ? colors.successSoft
      : tone === 'danger'
        ? colors.dangerSoft
        : tone === 'warning'
          ? colors.warningSoft
          : tone === 'info'
            ? colors.infoSoft
            : colors.cardAlt;
  const fg =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'warning'
          ? colors.warning
          : tone === 'info'
            ? colors.info
            : colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function EmptyState(props: { title?: string; message?: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{props.title ?? t('empty')}</Text>
      {props.message ? <Text style={styles.emptyText}>{props.message}</Text> : null}
      {props.action ? <View style={{ marginTop: spacing.md }}>{props.action}</View> : null}
    </View>
  );
}

export function LoadingView({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.emptyText}>{label ?? t('loading')}</Text>
    </View>
  );
}

export function ErrorView(props: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.danger }]}>{t('error')}</Text>
      <Text style={styles.emptyText}>{props.message}</Text>
      {props.onRetry ? <Button title={t('retry')} onPress={props.onRetry} style={{ marginTop: spacing.md }} /> : null}
    </View>
  );
}

export function ModalSheet(props: { visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{props.title}</Text>
            <Pressable onPress={props.onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={{ fontSize: font.lg, color: colors.muted }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: spacing.md }}>
            {props.children}
          </ScrollView>
          {props.footer}
        </View>
      </View>
    </Modal>
  );
}

export function TabPills<T extends string>(props: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
      {props.tabs.map(tab => {
        const active = tab.value === props.value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => props.onChange(tab.value)}
            style={[styles.pill, active && styles.pillActive]}>
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ListRow(props: {
  title: string;
  subtitle?: string;
  right?: string;
  rightSub?: string;
  tone?: 'default' | 'danger' | 'success';
  onPress?: () => void;
  badge?: string;
}) {
  const toneColor = props.tone === 'danger' ? colors.danger : props.tone === 'success' ? colors.success : colors.text;
  const body = (
    <View style={styles.listRow}>
      <View style={{ flex: 1, paddingRight: spacing.sm }}>
        <Text style={styles.listTitle} numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text style={styles.listSub} numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {props.badge ? <Badge text={props.badge} tone={props.tone === 'danger' ? 'danger' : 'default'} /> : null}
        {props.right ? (
          <Text style={[styles.listRight, { color: toneColor }]} numberOfLines={1}>
            {props.right}
          </Text>
        ) : null}
        {props.rightSub ? <Text style={styles.listSub}>{props.rightSub}</Text> : null}
      </View>
    </View>
  );
  if (!props.onPress) {return body;}
  return (
    <Pressable onPress={props.onPress} android_ripple={{ color: colors.border }}>
      {body}
    </Pressable>
  );
}

export function Pill(props: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={[styles.pill, props.selected && styles.pillActive]}>
      <Text style={[styles.pillText, props.selected && styles.pillTextActive]}>{props.label}</Text>
    </Pressable>
  );
}

/** Simple horizontal bar chart used on the dashboard (no chart dependency). */
export function Bars(props: { data: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(...props.data.map(d => d.value), 1);
  return (
    <View style={{ gap: spacing.sm }}>
      {props.data.map(d => (
        <View key={d.label} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.listSub}>{d.label}</Text>
            <Text style={styles.listSub}>{props.format(d.value)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.max(2, (d.value / max) * 100)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingBottom: spacing.xxl },
  padded: { padding: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  section: { marginBottom: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  button: {
    minHeight: touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.primarySoft },
  buttonDanger: { backgroundColor: colors.danger },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonText: { fontSize: font.md, fontWeight: '700' },
  field: { marginBottom: spacing.md },
  fieldLabel: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.xs, fontWeight: '600' },
  inputWrap: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: { flex: 1, minHeight: touchTarget, fontSize: font.md, color: colors.text, paddingVertical: spacing.sm },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: font.xs, marginTop: 2 },
  fieldHint: { color: colors.faint, fontSize: font.xs, marginTop: 2 },
  select: { minHeight: touchTarget },
  selectText: { flex: 1, fontSize: font.md, color: colors.text },
  selectCaret: { color: colors.muted, fontSize: font.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: spacing.sm },
  rowLabel: { color: colors.muted, fontSize: font.sm, flexShrink: 1 },
  rowLabelBold: { color: colors.text, fontWeight: '700', fontSize: font.md },
  rowValue: { fontSize: font.sm, color: colors.text, flexShrink: 1 },
  rowValueBold: { fontWeight: '700', fontSize: font.md },
  kpi: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  kpiLabel: { fontSize: font.xs, color: colors.muted, marginBottom: spacing.xs },
  kpiValue: { fontSize: font.lg, fontWeight: '800' },
  kpiSub: { fontSize: font.xs, color: colors.faint, marginTop: 2 },
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: font.xs, fontWeight: '700' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyText: { fontSize: font.sm, color: colors.muted, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionLabel: { fontSize: font.md, color: colors.text },
  optionSub: { fontSize: font.xs, color: colors.muted },
  pills: { gap: spacing.sm, paddingVertical: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: font.sm, color: colors.muted, fontWeight: '600' },
  pillTextActive: { color: colors.onPrimary },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: touchTarget,
  },
  listTitle: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  listSub: { fontSize: font.xs, color: colors.muted },
  listRight: { fontSize: font.md, fontWeight: '700' },
  barTrack: { height: 6, backgroundColor: colors.cardAlt, borderRadius: radius.pill, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.primary, borderRadius: radius.pill },
});

const pinStyles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  dots: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  dotFilled: { backgroundColor: colors.primary },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', width: 276, alignSelf: 'center' },
  key: { width: 92, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  keyText: { fontSize: font.xl, fontWeight: '600', color: colors.text },
  steps: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  step: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  stepActive: { backgroundColor: colors.primary, width: 20 },
});
