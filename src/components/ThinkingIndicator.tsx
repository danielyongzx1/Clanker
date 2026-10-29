import Feather from '@expo/vector-icons/Feather';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

function thoughtLabel(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `Thought for ${s}s`;
  return `Thought for ${Math.floor(s / 60)}m ${s % 60}s`;
}

type Props = {
  /** True while the model is thinking (no answer tokens yet). */
  thinking: boolean;
  expanded: boolean;
  /** False while there are no streamed thoughts to show; taps are then a no-op. */
  toggleable: boolean;
  thoughtMs?: number;
  onToggle: () => void;
};

/** The pulsing "Thinking…" pill. Tapping it shows or hides the model's streamed thoughts. */
export function ThinkingIndicator({ thinking, expanded, toggleable, thoughtMs, onToggle }: Props) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    if (thinking) {
      pulse.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [thinking, pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: 0.3 + 0.7 * pulse.value,
  }));

  return (
    <Pressable
      onPress={onToggle}
      disabled={!toggleable}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={thinking ? 'Show or hide thinking' : 'Show or hide thoughts'}
      style={({ pressed }) => [styles.pill, pressed && toggleable && { opacity: 0.6 }]}
    >
      <Animated.View style={[styles.dot, { backgroundColor: colors.textSecondary }, dotStyle]} />
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {thinking ? 'Thinking…' : thoughtMs ? thoughtLabel(thoughtMs) : 'Thoughts'}
      </Text>
      {toggleable && (
        <Feather
          name="chevron-down"
          size={14}
          color={colors.textSecondary}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, marginLeft: 2, alignSelf: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 15, fontWeight: '500' },
});
