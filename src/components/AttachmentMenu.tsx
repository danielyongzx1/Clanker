import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { Colors } from '@/lib/theme';
import { useTheme } from '@/lib/theme';

export type AttachAction = 'camera' | 'photos' | 'files';

const ITEMS: { key: AttachAction; icon: 'camera' | 'image' | 'paperclip'; label: string }[] = [
  { key: 'camera', icon: 'camera', label: 'Camera' },
  { key: 'photos', icon: 'image', label: 'Photos' },
  { key: 'files', icon: 'paperclip', label: 'Files' },
];

// Enter: strong ease-out so the card feels instant; exit: shorter, dismissal should be snappy.
const ENTER = { duration: 220, easing: Easing.bezier(0.23, 1, 0.32, 1) };
const EXIT = { duration: 140, easing: Easing.bezier(0.3, 0, 0.8, 0.6) };
// Fraction of the master progress each row trails the one before it, for a light cascade.
const ROW_STAGGER = 0.18;

type Props = {
  visible: boolean;
  /** Screen x of the plus button, which the card's left edge aligns with. */
  x: number;
  /** Screen distance from the top of the plus button down to the bottom of the screen. */
  bottom: number;
  onPick: (action: AttachAction) => void;
  onClose: () => void;
};

/**
 * Popover anchored to the composer's plus button: the card fades/scales up from the button's
 * corner and its rows cascade in. Rendered in a transparent Modal so it paints over the
 * keyboard layer and is never clipped by the composer box (which has overflow: hidden).
 */
export function AttachmentMenu({ visible, x, bottom, onPick, onClose }: Props) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  // Stay mounted through the exit animation; unmount only when it has played out.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

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

  // One master value drives everything, so reversing mid-open retargets smoothly.
  const cardStyle = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [
      { translateY: interpolate(open.value, [0, 1], reduceMotion ? [8, 0] : [0, 0]) },
      { scale: interpolate(open.value, [0, 1], reduceMotion ? [1, 1] : [0.92, 1]) },
    ],
  }));

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      {/* Transparent: it only catches taps outside the card. No dimming, like the reference. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={visible ? onClose : undefined}
        accessibilityLabel="Close attach menu"
      />
      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[styles.anchor, { bottom, left: x }, cardStyle]}
      >
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {ITEMS.map((item, i) => (
            <Row
              key={item.key}
              label={item.label}
              icon={item.icon}
              index={i}
              open={open}
              reduceMotion={!!reduceMotion}
              onPress={() => onPick(item.key)}
              colors={colors}
            />
          ))}
        </View>
      </Animated.View>
    </Modal>
  );
}

function Row({
  label,
  icon,
  index,
  open,
  reduceMotion,
  onPress,
  colors,
}: {
  label: string;
  icon: 'camera' | 'image' | 'paperclip';
  index: number;
  open: SharedValue<number>;
  reduceMotion: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  // Each row rides the master progress a little later: a light cascade, no extra timers,
  // and closing mid-cascade still retargets.
  const start = index * ROW_STAGGER;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(open.value, [start, Math.min(start + 0.55, 1)], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(
          open.value,
          [start, Math.min(start + 0.55, 1)],
          reduceMotion ? [0, 0] : [10, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.surfaceHover }]}>
          <Feather name={icon} size={19} color={colors.text} />
        </View>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    // The card grows out of the plus button: transforms run from its bottom-left corner.
    transformOrigin: '0% 100%',
  },
  card: {
    borderRadius: 26,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  rowPressed: { opacity: 0.6, transform: [{ scale: 0.97 }] },
  iconCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 17, fontWeight: '500' },
});
