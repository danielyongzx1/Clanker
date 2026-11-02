import Feather from '@expo/vector-icons/Feather';
import * as Haptics from '@/lib/haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

const SPRING = { damping: 24, stiffness: 300, mass: 0.8 };

type Option<T extends string> = { value: T; label: string; icon?: keyof typeof Feather.glyphMap };

/**
 * A pill track whose thumb slides to the chosen option. The thumb moves by transform rather than
 * by position so the slide stays on Reanimated's fast path instead of relaying out every frame;
 * it is hidden until the track has been measured so it never shows in the wrong place.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const count = options.length;
  const share = 100 / count;
  const pos = useSharedValue(index);
  const width = useSharedValue(0);

  useEffect(() => {
    pos.set(withSpring(index, SPRING));
  }, [index, pos]);

  const thumb = useAnimatedStyle(() => ({
    opacity: width.value > 0 ? 1 : 0,
    transform: [{ translateX: (pos.value * width.value) / count }],
  }));

  return (
    <View style={[styles.track, { backgroundColor: colors.segmentTrack }]} accessibilityRole="radiogroup">
      <View style={styles.items} onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.thumb, { width: `${share}%`, backgroundColor: colors.segmentThumb }, thumb]} />
        {options.map((o) => {
          const selected = o.value === value;
          const color = selected ? colors.text : colors.textSecondary;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                if (selected) return;
                Haptics.selectionAsync();
                onChange(o.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={styles.item}
            >
              {o.icon && <Feather name={o.icon} size={15} color={color} />}
              <Text style={[styles.label, { color }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderRadius: 12, padding: 3 },
  items: { flexDirection: 'row' },
  thumb: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 9,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    // No elevation: on Android it would lift the thumb over the labels.
    shadowRadius: 3,
  },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  label: { fontSize: 14, fontWeight: '500' },
});
