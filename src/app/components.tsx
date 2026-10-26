/** Shared UI primitives: everything the screens are built from. */
import React, { type ReactNode } from 'react';
import {
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
import { colors, font, radius, spacing, touchTarget } from './theme';
import { useI18n } from './i18n';

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
  if (scroll) {
    return (
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, padded && styles.padded]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            ) : undefined
          }>
          {children}
        </ScrollView>
        {footer}
      </View>
    );
  }
  return <View style={[styles.screen, padded && styles.padded]}>{children}</View>;
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
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{props.title}</Text>
            <Pressable onPress={props.onClose} hitSlop={12}>
              <Text style={{ fontSize: font.lg, color: colors.muted }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.md }}>
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
