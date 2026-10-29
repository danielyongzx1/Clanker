import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/lib/theme';

export type MenuIcon = { feather: keyof typeof Feather.glyphMap } | { mci: keyof typeof MaterialCommunityIcons.glyphMap };

export type MenuItem = {
  label: string;
  icon: MenuIcon;
  onPress: () => void;
  destructive?: boolean;
};

/** Where the menu opens: the screen point that was pressed. */
export type MenuAnchor = { x: number; y: number };

const WIDTH = 270;
const ROW = 56;
const PAD = 8;
const MARGIN = 16;

const ENTER = { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) };
const EXIT = { duration: 120, easing: Easing.bezier(0.3, 0, 0.8, 0.6) };

export function MenuGlyph({ icon, size, color }: { icon: MenuIcon; size: number; color: string }) {
  return 'feather' in icon ? (
    <Feather name={icon.feather} size={size} color={color} />
  ) : (
    <MaterialCommunityIcons name={icon.mci} size={size} color={color} />
  );
}

/**
 * A popup menu that grows out of the point that was long-pressed, as in ChatGPT's project list.
 * It opens below the point when there is room and above it otherwise, kept inside the screen.
 */
export function ContextMenu({
  anchor,
  items,
  onClose,
}: {
  /** Null hides the menu. */
  anchor: MenuAnchor | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // Kept through the exit animation, so the card doesn't vanish mid-fade.
  const [shown, setShown] = useState<{ anchor: MenuAnchor; items: MenuItem[] } | null>(null);
  if (anchor && shown?.anchor !== anchor) setShown({ anchor, items });

  const open = useSharedValue(0);
  useEffect(() => {
    if (anchor) {
      open.set(withTiming(1, ENTER));
      return;
    }
    open.set(
      withTiming(0, EXIT, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(setShown, null);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  const height = (shown?.items.length ?? 0) * ROW + PAD * 2;
  const point = shown?.anchor ?? { x: 0, y: 0 };
  const below = point.y + height + MARGIN <= screen.height - insets.bottom;
  const top = below ? point.y + 4 : Math.max(insets.top + MARGIN, point.y - height - 4);
  const left = Math.min(Math.max(MARGIN, point.x - 40), screen.width - WIDTH - MARGIN);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: open.value,
    transform: [{ scale: reduceMotion ? 1 : 0.92 + 0.08 * open.value }],
  }));

  if (!shown) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View
        pointerEvents={anchor ? 'auto' : 'none'}
        style={[
          styles.card,
          { top, left, backgroundColor: colors.surface, borderColor: colors.border },
          // Grows from the pressed point.
          { transformOrigin: [point.x - left, below ? 0 : height, 0] },
          cardStyle,
        ]}
      >
        {shown.items.map((item) => {
          const color = item.destructive ? colors.danger : colors.text;
          return (
            <Pressable
              key={item.label}
              onPress={() => {
                // Gone at once rather than fading: the action may open a dialog of its own, and on
                // iOS a modal still going away would take a newly presented one with it.
                open.set(0);
                setShown(null);
                onClose();
                item.onPress();
              }}
              accessibilityRole="menuitem"
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
            >
              <MenuGlyph icon={item.icon} size={21} color={color} />
              <Text style={[styles.label, { color }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: WIDTH,
    paddingVertical: PAD,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  row: { height: ROW, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  label: { fontSize: 17 },
});
