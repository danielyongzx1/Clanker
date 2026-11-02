import * as Haptics from '@/lib/haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { describeEffort } from '@/lib/providers';
import { useTheme } from '@/lib/theme';

// ChatGPT's effort slider: a pill track with a blue fill that ends in a white knob, which
// snaps between one stop per level. Dots mark each stop.
const HEIGHT = 72;
const PAD = 12;
const FILL = HEIGHT - PAD * 2;
const KNOB = 40;
const DOT = 10;
const SPRING = { damping: 22, stiffness: 320, mass: 0.8 };

type Props = {
  levels: string[];
  value: string;
  onChange: (level: string) => void;
};

export function EffortSlider({ levels, value, onChange }: Props) {
  const { colors } = useTheme();
  const index = Math.max(0, levels.indexOf(value));
  // The stop under the finger mid-drag. It stays local so only the slider re-renders until
  // release, when it's committed through onChange.
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? index;
  const last = levels.length - 1;
  const stop = (i: number) => (last > 0 ? i / last : 0);

  // Knob position as a fraction of its travel, from the first stop (0) to the last (1).
  // Everything is laid out in percentages of the track, so the first frame is already in
  // place without waiting for a layout pass to learn the width.
  const pos = useSharedValue(stop(index));
  // Only the drag needs pixels, and it can't start before the track has been laid out.
  const width = useSharedValue(0);
  // The drag runs entirely on the UI thread; JS only hears about it when the stop changes.
  const dragging = useSharedValue(false);
  const current = useSharedValue(index);

  // Springs to a level picked outside a drag (accessibility actions); a drag has already put
  // the knob there by the time it commits.
  const placed = useRef(stop(index));
  useEffect(() => {
    current.set(index);
    const target = stop(index);
    if (placed.current === target || dragging.get()) return;
    placed.current = target;
    pos.set(withSpring(target, SPRING));
    // stop only changes with the level count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, last]);

  const hover = (i: number) => {
    Haptics.selectionAsync();
    setPreview(i);
  };

  const commit = (i: number) => {
    placed.current = stop(i);
    if (levels[i] !== value) onChange(levels[i]);
    setPreview(null);
  };

  const track = (locationX: number, animate: boolean) => {
    'worklet';
    const travel = width.get() - PAD * 2 - FILL;
    const f = travel > 0 ? Math.min(Math.max((locationX - PAD - FILL / 2) / travel, 0), 1) : 0;
    pos.set(animate ? withSpring(f, SPRING) : f);
    const i = Math.round(f * last);
    if (i === current.get()) return;
    current.set(i);
    scheduleOnRN(hover, i);
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
      pos.set(withSpring(last > 0 ? current.get() / last : 0, SPRING));
      scheduleOnRN(commit, current.get());
    },
  });

  // Each moving piece is as wide as the knob's travel, so a percentage translate (of its own
  // width) moves it exactly with the knob. The fill is a fixed cap at the first stop, a body
  // running up to the knob and a round end under it, all clipped to the pill.
  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateX: `${(pos.value - 1) * 100}%` }] }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: `${pos.value * 100}%` }] }));

  const [word, rest] = describeEffort(levels[shown] ?? value);

  return (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>
        <Text style={{ color: colors.accentText }}>{word}</Text> {rest}
      </Text>

      <GestureDetector gesture={pan}>
        <View
          onLayout={(e) => width.set(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Effort"
          accessibilityValue={{ text: `${word} ${rest}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const i = Math.min(Math.max(index + (e.nativeEvent.actionName === 'increment' ? 1 : -1), 0), last);
            if (i === index) return;
            Haptics.selectionAsync();
            onChange(levels[i]);
          }}
          style={[styles.track, { backgroundColor: colors.surface, borderColor: colors.chromeBorder }]}
        >
          <View style={styles.fillClip}>
            <View style={[styles.fillStart, { backgroundColor: colors.accent }]} />
            <Animated.View style={[styles.fillBody, { backgroundColor: colors.accent }, bodyStyle]} />
            <Animated.View style={[styles.fillRun, knobStyle]}>
              <View style={[styles.fillEnd, { backgroundColor: colors.accent }]} />
            </Animated.View>
          </View>
          <View style={styles.dots}>
            {levels.map((level, i) => (
              <Dot key={level} at={stop(i)} pos={pos} off={colors.textTertiary} />
            ))}
          </View>
          <Animated.View style={[styles.knobRun, knobStyle]}>
            <View style={styles.knob} />
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

/** A stop marker, tinted to sit on the fill once the knob has passed it. */
function Dot({ at, pos, off }: { at: number; pos: SharedValue<number>; off: string }) {
  const style = useAnimatedStyle(() => ({ backgroundColor: pos.value > at ? 'rgba(255,255,255,0.35)' : off }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  label: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 18 },
  track: { height: HEIGHT, borderRadius: HEIGHT / 2, borderWidth: StyleSheet.hairlineWidth },
  fillClip: {
    position: 'absolute',
    left: PAD,
    right: PAD,
    top: PAD,
    height: FILL,
    borderRadius: FILL / 2,
    overflow: 'hidden',
  },
  // The fill at the first stop, so a spring overshooting it never shrinks the fill smaller.
  fillStart: { position: 'absolute', left: 0, width: FILL, height: FILL, borderRadius: FILL / 2 },
  // Ends at the knob centre at the last stop, before it's slid back.
  fillBody: { position: 'absolute', left: FILL / 2, right: FILL / 2, height: FILL },
  // Carries the round end of the fill under the knob.
  fillRun: { position: 'absolute', left: 0, right: FILL, height: FILL },
  fillEnd: { width: FILL, height: FILL, borderRadius: FILL / 2 },
  // Spaced so the dot centres land on the stops.
  dots: {
    position: 'absolute',
    left: PAD + FILL / 2 - DOT / 2,
    right: PAD + FILL / 2 - DOT / 2,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  // As wide as the knob's travel, with the knob at its left edge centred on the first stop.
  knobRun: {
    position: 'absolute',
    left: PAD + FILL / 2 - KNOB / 2,
    right: PAD + FILL / 2 + KNOB / 2,
    top: (HEIGHT - KNOB) / 2,
    height: KNOB,
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#FFFFFF' },
});
