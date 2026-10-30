import { useEffect, useState } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { OverKeyboardView } from 'react-native-keyboard-controller';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { formatTokens } from '@/lib/context';
import { useTheme, type Colors } from '@/lib/theme';
import type { ContextUsage } from '@/lib/usage';
import { useSettings } from '@/store/settings';

// Same motion as the attach menu: a quick ease-out in, a shorter exit.
const ENTER = { duration: 220, easing: Easing.bezier(0.23, 1, 0.32, 1) };
const EXIT = { duration: 140, easing: Easing.bezier(0.3, 0, 0.8, 0.6) };
const TOOLS_COLOR = '#A78BFA';
const CARD_WIDTH = 320;

const totalOf = (u: ContextUsage) => u.system + u.tools + u.messages;

function parts(u: ContextUsage, colors: Colors) {
  if (u.remote) return [{ label: 'Context held by backend', tokens: totalOf(u), color: colors.accent }];
  return [
    { label: 'System prompt', tokens: u.system, color: colors.textTertiary },
    { label: 'Tool definitions', tokens: u.tools, color: TOOLS_COLOR },
    { label: 'Messages', tokens: u.messages, color: colors.accent },
  ];
}

/** Thin vertical gauge that fills from the bottom as the chat uses up the model's budget. */
export function ContextMeter({ usage }: { usage: ContextUsage }) {
  const { colors } = useTheme();
  const warnPercent = useSettings((s) => s.compression.trigger);
  const frac = totalOf(usage) / usage.budget;
  const threshold = usage.remote ? 90 : warnPercent;
  return (
    <View style={styles.meter}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.textTertiary, opacity: 0.3 }]} />
      <View
        style={[
          styles.meterFill,
          { height: `${Math.min(1, frac) * 100}%`, backgroundColor: frac * 100 >= threshold ? colors.danger : colors.accent },
        ]}
      />
    </View>
  );
}

type PopoverProps = {
  visible: boolean;
  usage: ContextUsage;
  /** Screen distance from the composer's right edge to the right of the screen. */
  right: number;
  /** Screen distance from the top of the composer down to the bottom of the screen. */
  bottom: number;
  onClose: () => void;
};

/** Breakdown of the context estimate, popping up from the composer's right-hand corner.
 *  Lives in an over-keyboard layer (not a Modal, which grabs focus and closes the keyboard),
 *  so it floats over the keys and leaves them open. */
export function ContextPopover({ visible, usage, right, bottom, onClose }: PopoverProps) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  // Past this share of the budget the app starts compressing history on its own.
  const warnPercent = useSettings((s) => s.compression.trigger);
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  // The layer hosts no activity of its own, so back must be routed here while it is up.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const open = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      open.set(withTiming(1, ENTER));
      return;
    }
    if (mounted) {
      open.set(
        withTiming(0, EXIT, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(setMounted, false);
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [
      { translateY: interpolate(open.value, [0, 1], reduceMotion ? [8, 0] : [0, 0]) },
      { scale: interpolate(open.value, [0, 1], reduceMotion ? [1, 1] : [0.92, 1]) },
    ],
  }));

  if (!mounted) return null;
  const total = totalOf(usage);
  const percent = Math.round((total / usage.budget) * 100);
  const threshold = usage.remote ? 90 : warnPercent;
  const prefix = usage.estimated === false ? '' : '~';
  // Over budget, the bar shows each part's share of the total instead.
  const scale = Math.max(total, usage.budget);
  const width = Math.min(CARD_WIDTH, Dimensions.get('window').width - 24);

  return (
    <OverKeyboardView visible={mounted}>
      <Pressable
        style={StyleSheet.absoluteFill}
        pointerEvents={visible ? 'auto' : 'none'}
        onPress={visible ? onClose : undefined}
        accessibilityLabel="Close context usage"
      />
      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.anchor, { bottom, right: Math.max(12, right), width }, cardStyle]}
      >
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.headerText, { color: colors.textSecondary }]}>
              <Text style={{ color: percent >= threshold ? colors.danger : colors.text, fontWeight: '700' }}>
                {percent}%
              </Text>
              {'  '}of context used
            </Text>
            <Text style={[styles.headerText, { color: colors.text, fontWeight: '600' }]}>
              {prefix}{formatTokens(total)} / {formatTokens(usage.budget)}
            </Text>
          </View>

          <View style={[styles.bar, { backgroundColor: colors.surfaceHover }]}>
            {parts(usage, colors).map((p) =>
              p.tokens > 0 ? (
                <View
                  key={p.label}
                  style={{ width: `${(p.tokens / scale) * 100}%`, minWidth: 3, backgroundColor: p.color, borderRadius: 3 }}
                />
              ) : null
            )}
          </View>

          {parts(usage, colors).map((p) => (
            <View key={p.label} style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: p.color }]} />
              <Text style={[styles.rowLabel, { color: colors.text }]}>{p.label}</Text>
              <Text style={[styles.rowValue, { color: colors.text }]}>{prefix}{formatTokens(p.tokens)}</Text>
            </View>
          ))}

          <Text style={[styles.note, { color: colors.textTertiary }]}>
            {usage.remote
              ? `${usage.estimated ? 'Estimated by' : 'Reported by'} the remote backend. History and compression are managed on the host.`
              : `Rough estimate against this model's budget. Past ${warnPercent}%, older history is compressed automatically.`}
          </Text>
        </View>
      </Animated.View>
    </OverKeyboardView>
  );
}

const styles = StyleSheet.create({
  meter: { width: 6, height: 22, borderRadius: 3, overflow: 'hidden', justifyContent: 'flex-end' },
  meterFill: { width: '100%', borderRadius: 3 },
  anchor: {
    position: 'absolute',
    // The card grows out of the meter, near the composer's bottom-right corner.
    transformOrigin: '100% 100%',
  },
  card: {
    borderRadius: 22,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  headerText: { fontSize: 16 },
  bar: { flexDirection: 'row', gap: 2, height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  rowLabel: { flex: 1, fontSize: 15 },
  rowValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 17, marginTop: 14 },
});
