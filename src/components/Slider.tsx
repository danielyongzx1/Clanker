import * as Haptics from '@/lib/haptics';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/lib/theme';

// A thin track with an accent fill and a white knob. The knob follows the finger freely and
// springs onto the nearest step when let go; each step crossed ticks and reports the new value.
const HEIGHT = 36;
const KNOB = 28;
const TRACK = 6;
const SPRING = { damping: 22, stiffness: 320, mass: 0.8 };

type Props = {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
  /** How the value is read out, e.g. as a percentage. */
  format?: (value: number) => string;
};

export function Slider({ value, min, max, step, onChange, accessibilityLabel, format = String }: Props) {
  const { colors } = useTheme();
  const span = max - min;
  const frac = (v: number) => (v - min) / span;

  // Knob position as a fraction of its travel. Everything is laid out in percentages of the
  // track, so the first frame is already in place; only the drag needs the width in pixels.
  const pos = useSharedValue(frac(value));
  const width = useSharedValue(0);
  const dragging = useSharedValue(false);
  const current = useSharedValue(value);

  // Springs to a value set from outside a drag, such as another slider pushing this one along.
  useEffect(() => {
    current.set(value);
    if (!dragging.get()) pos.set(withSpring((value - min) / span, SPRING));
  }, [value, min, span, current, dragging, pos]);

  const report = (v: number) => {
    Haptics.selectionAsync();
    onChange(v);
  };

  const track = (x: number, animate: boolean) => {
    'worklet';
    const travel = width.get() - KNOB;
    const f = travel > 0 ? Math.min(Math.max((x - KNOB / 2) / travel, 0), 1) : 0;
    pos.set(animate ? withSpring(f, SPRING) : f);
    const v = Math.min(max, min + Math.round((f * span) / step) * step);
    if (v === current.get()) return;
    current.set(v);
    scheduleOnRN(report, v);
  };

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: (e) => {
      'worklet';
      dragging.set(true);
      track(e.x, true);
    },
    onUpdate: (e) => {
      'worklet';
      track(e.x, false);
    },
    onFinalize: () => {
      'worklet';
      dragging.set(false);
      pos.set(withSpring((current.get() - min) / span, SPRING));
    },
  });

  // The fill and the knob's carrier are each as wide as the knob's travel, so translating them
  // by a percentage of their own width moves them exactly with the knob.
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: `${(pos.value - 1) * 100}%` }] }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: `${pos.value * 100}%` }] }));

  const nudge = (direction: number) => {
    const v = Math.min(max, Math.max(min, value + direction * step));
    if (v !== value) report(v);
  };

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: format(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={styles.container}
      >
        <View style={[styles.track, { backgroundColor: colors.toggleTrack }]}>
          <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fillStyle]} />
        </View>
        <Animated.View style={[styles.knobRun, knobStyle]}>
          <View style={styles.knob} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { height: HEIGHT, justifyContent: 'center' },
  // Inset by half a knob at each end, so the track's ends line up with the knob's centre.
  track: { marginHorizontal: KNOB / 2, height: TRACK, borderRadius: TRACK / 2, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill, borderRadius: TRACK / 2 },
  knobRun: { position: 'absolute', left: 0, right: KNOB, top: (HEIGHT - KNOB) / 2, height: KNOB },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
});
