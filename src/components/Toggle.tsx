import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

// An iOS-sized switch drawn the same on both platforms. The knob springs across with a slight
// overshoot while the track fades to the accent, and holding it down stretches the knob toward
// the side it is about to move to. It only draws; the row around it takes the touch.
const WIDTH = 51;
const HEIGHT = 31;
const PAD = 2;
const KNOB = HEIGHT - PAD * 2;
const TRAVEL = WIDTH - PAD * 2 - KNOB;
const STRETCH = 7;
const SPRING = { damping: 18, stiffness: 280, mass: 0.7 };
const PRESS = { duration: 140 };

export function Toggle({ value, pressed = false }: { value: boolean; pressed?: boolean }) {
  const { colors } = useTheme();
  const on = useSharedValue(value ? 1 : 0);
  const held = useSharedValue(0);

  useEffect(() => {
    on.set(withSpring(value ? 1 : 0, SPRING));
  }, [value, on]);

  useEffect(() => {
    held.set(withTiming(pressed ? 1 : 0, PRESS));
  }, [pressed, held]);

  // Only transforms and colour animate, so every frame stays on Reanimated's fast path; a width
  // animation would relayout the screen on each frame. The stretched knob is therefore drawn as
  // two round caps that slide apart with a strip between them that scales to fill the gap.
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.min(Math.max(on.value, 0), 1), [0, 1], [colors.toggleTrack, colors.accent]),
  }));

  // When on, the knob grows leftward so its right edge stays put.
  const left = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * (TRAVEL - held.value * STRETCH) }],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * (TRAVEL - held.value * STRETCH) + held.value * STRETCH }],
  }));
  const middle = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * (TRAVEL - held.value * STRETCH) }, { scaleX: held.value }],
  }));

  return (
    <Animated.View style={[styles.track, track]}>
      <Animated.View style={[styles.cap, left]} />
      <Animated.View style={[styles.cap, right]} />
      {/* Drawn last and without a shadow so it hides where the caps' shadows overlap. */}
      <Animated.View style={[styles.middle, middle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: { width: WIDTH, height: HEIGHT, borderRadius: HEIGHT / 2 },
  cap: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    // iOS only; Android elevation would lift the caps above the strip between them.
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  middle: {
    position: 'absolute',
    top: PAD,
    left: PAD + KNOB / 2,
    width: STRETCH,
    height: KNOB,
    backgroundColor: '#FFFFFF',
    transformOrigin: 'left',
  },
});
