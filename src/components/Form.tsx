import Feather from '@expo/vector-icons/Feather';
import * as Haptics from '@/lib/haptics';
import { Children, Fragment, isValidElement, useEffect, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BrandIcon, type BrandId } from '@/components/BrandIcon';
import { Toggle } from '@/components/Toggle';
import { useTheme } from '@/lib/theme';

/** Form pieces shared by the settings screens. */

type IconName = keyof typeof Feather.glyphMap;

const PAD = 16;
const ICON = 20;
const GAP = 14;
/** Separators start under the row titles, past the icons. */
export const ICON_INSET = PAD + ICON + GAP;

const TURN = { duration: 220, easing: Easing.bezier(0.23, 1, 0.32, 1) };

export function Label({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.textSecondary }]}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, { color: colors.text, backgroundColor: colors.surface }, props.style]}
    />
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? colors.text : colors.border, backgroundColor: selected ? colors.surface : 'transparent' },
      ]}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

/** A titled card of rows, with hairlines between them. Falsy children are skipped. */
export function Section({
  title,
  footer,
  inset = ICON_INSET,
  style,
  children,
}: {
  title?: string;
  footer?: string;
  inset?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.section, style]}>
      {title && <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{title}</Text>}
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 && <View style={[styles.separator, { marginLeft: inset, backgroundColor: colors.border }]} />}
            {row}
          </Fragment>
        ))}
      </View>
      {footer && <Text style={[styles.footer, { color: colors.textTertiary }]}>{footer}</Text>}
    </View>
  );
}

type RowProps = {
  icon?: IconName;
  /** A brand mark in place of the feather icon, when friendly model names are on. */
  brand?: BrandId;
  title: string;
  /** Second line under the title. */
  detail?: string;
  /** Trailing text, such as the current choice behind a navigation row. */
  value?: string;
  onPress?: () => void;
  /** Shown by default on plain rows that go somewhere when tapped. */
  chevron?: boolean;
  selected?: boolean;
  /** Greys the title, for an item that's set aside but still tappable. */
  muted?: boolean;
  tint?: 'link' | 'danger';
  disabled?: boolean;
  /** Drawn at the trailing edge; given whether the row is being pressed. */
  trailing?: (pressed: boolean) => ReactNode;
  accessibilityRole?: 'button' | 'switch' | 'radio';
  accessibilityState?: { checked?: boolean; selected?: boolean };
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};

export function Row({
  icon,
  brand,
  title,
  detail,
  value,
  onPress,
  selected,
  muted,
  tint,
  disabled,
  trailing,
  chevron = !!onPress && !trailing && !tint && selected === undefined,
  accessibilityRole = 'button',
  accessibilityState,
  accessibilityActions,
  onAccessibilityAction,
}: RowProps) {
  const { colors } = useTheme();
  const tintColor = tint === 'link' ? colors.link : tint === 'danger' ? colors.danger : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled, ...accessibilityState }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
    >
      {({ pressed }) => (
        // Fades rather than snaps when a row is turned off by another setting.
        <Animated.View
          style={[
            styles.rowInner,
            { opacity: disabled ? 0.4 : 1, transitionProperty: 'opacity', transitionDuration: 200 },
          ]}
        >
          {brand ? <BrandIcon brand={brand} size={ICON} /> : icon ? <Feather name={icon} size={ICON} color={tintColor ?? colors.textSecondary} /> : null}
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: tintColor ?? (muted ? colors.textTertiary : colors.text) }]}>
              {title}
            </Text>
            {detail && (
              <Text numberOfLines={2} style={[styles.rowDetail, { color: colors.textTertiary }]}>
                {detail}
              </Text>
            )}
          </View>
          {value && (
            <Text numberOfLines={1} style={[styles.rowValue, { color: colors.textTertiary }]}>
              {value}
            </Text>
          )}
          {trailing?.(pressed)}
          {selected && <Feather name="check" size={18} color={colors.accentText} />}
          {chevron && <Feather name="chevron-right" size={18} color={colors.textTertiary} />}
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * A row that flips a setting when tapped anywhere along it. Given onPress, the row opens more
 * settings instead and only the switch, set off by a divider, flips it.
 */
export function ToggleRow({
  value,
  onValueChange,
  onPress,
  ...row
}: Omit<RowProps, 'trailing' | 'value' | 'chevron'> & { value: boolean; onValueChange: (on: boolean) => void }) {
  const { colors } = useTheme();
  const flip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onValueChange(!value);
  };

  if (!onPress) {
    return (
      <Row
        {...row}
        onPress={flip}
        trailing={(pressed) => <Toggle value={value} pressed={pressed} />}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      />
    );
  }

  return (
    <Row
      {...row}
      onPress={onPress}
      trailing={() => (
        <View style={styles.split}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Pressable
            onPress={flip}
            disabled={row.disabled}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 16 }}
            accessibilityRole="switch"
            accessibilityLabel={row.title}
            accessibilityState={{ checked: value, disabled: row.disabled }}
          >
            {({ pressed }) => <Toggle value={value} pressed={pressed} />}
          </Pressable>
        </View>
      )}
      // Screen readers treat the row as one element, so the switch is offered as an action on it.
      accessibilityState={{ checked: value }}
      accessibilityActions={[{ name: 'toggle', label: value ? `Turn off ${row.title}` : `Turn on ${row.title}` }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'toggle' && flip()}
    />
  );
}

/** A heading that shows or hides the settings under it. */
export function Disclosure({
  title,
  initiallyOpen = false,
  children,
}: {
  title: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  const turn = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, TURN));
  }, [open, turn]);

  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 90}deg` }] }));

  return (
    <View>
      <Pressable
        onPress={() => setOpen(!open)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.disclosure, pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.disclosureTitle, { color: colors.textSecondary }]}>{title}</Text>
        <Animated.View style={chevron}>
          <Feather name="chevron-right" size={16} color={colors.textSecondary} />
        </Animated.View>
      </Pressable>
      {open && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '500', marginTop: 20, marginBottom: 8, marginLeft: 4 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  section: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: PAD,
  },
  card: { borderRadius: 16, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth },
  footer: { fontSize: 13, lineHeight: 18, marginTop: 8, marginHorizontal: PAD },
  row: { paddingHorizontal: PAD, minHeight: 52, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: GAP, paddingVertical: 12 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16 },
  rowDetail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  rowValue: { fontSize: 15, maxWidth: '45%' },
  split: { flexDirection: 'row', alignItems: 'center', gap: GAP, alignSelf: 'stretch' },
  divider: { width: StyleSheet.hairlineWidth, height: 28 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 28, marginLeft: 4, alignSelf: 'flex-start' },
  disclosureTitle: { fontSize: 15, fontWeight: '600' },
});
