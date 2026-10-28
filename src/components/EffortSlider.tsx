import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
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
  const [width, setWidth] = useState(0);
  const index = Math.max(0, levels.indexOf(value));
  // The stop under the finger mid-drag. It stays local so only the slider re-renders until
  // release, when it's committed through onChange.
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? index;
  // Knob centre, in track coordinates. Negative until the first layout.
  const pos = useSharedValue(-1);
  // The drag runs entirely on the UI thread; JS only hears about it when the stop changes.
  const dragging = useSharedValue(false);
  const current = useSharedValue(index);

  const step = levels.length > 1 ? (width - PAD * 2 - FILL) / (levels.length - 1) : 0;
  const stopX = (i: number) => PAD + FILL / 2 + i * step;
  const first = stopX(0);
  const lastStop = stopX(levels.length - 1);
  const span = width - PAD * 2;

  useEffect(() => {
    current.set(index);
    if (!width || dragging.get()) return;
    pos.set(pos.get() < 0 ? stopX(index) : withSpring(stopX(index), SPRING));
    // stopX only changes with width and the level count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, width, levels.length]);

  const hover = (i: number) => {
    Haptics.selectionAsync();
    setPreview(i);
  };

  const commit = (i: number) => {
    if (levels[i] !== value) onChange(levels[i]);
    setPreview(null);
  };

  const track = (locationX: number, animate: boolean) => {
    'worklet';
    const x = Math.min(Math.max(locationX, first), lastStop);
    pos.set(animate ? withSpring(x, SPRING) : x);
    const i = step ? Math.round((x - first) / step) : 0;
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
      pos.set(withSpring(first + current.get() * step, SPRING));
      scheduleOnRN(commit, current.get());
    },
  });

  // The fill is a full-length pill slid along inside a pill-shaped clip, so its rounded
  // right end follows the knob using only a transform — no per-frame layout.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.max(FILL, pos.value + FILL / 2 - PAD) - span }],
  }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value - KNOB / 2 }] }));

  const [word, rest] = describeEffort(levels[shown] ?? value);

  return (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>
        <Text style={{ color: colors.accentText }}>{word}</Text> {rest}
      </Text>

      <GestureDetector gesture={pan}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Effort"
          accessibilityValue={{ text: `${word} ${rest}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const i = Math.min(Math.max(index + (e.nativeEvent.actionName === 'increment' ? 1 : -1), 0), levels.length - 1);
            if (i === index) return;
            Haptics.selectionAsync();
            onChange(levels[i]);
          }}
          style={[styles.track, { backgroundColor: colors.surface, borderColor: colors.chromeBorder }]}
        >
          {width > 0 && (
            <>
              <View style={[styles.fillClip, { width: span }]}>
                <Animated.View style={[styles.fill, { width: span, backgroundColor: colors.accent }, fillStyle]} />
              </View>
              {levels.map((level, i) => (
                <Dot key={level} x={stopX(i)} pos={pos} off={colors.textTertiary} />
              ))}
              <Animated.View style={[styles.knob, knobStyle]} />
            </>
          )}
        </View>
      </GestureDetector>
    </View>
  );
}

/** A stop marker, tinted to sit on the fill once the knob has passed it. */
function Dot({ x, pos, off }: { x: number; pos: SharedValue<number>; off: string }) {
  const style = useAnimatedStyle(() => ({ backgroundColor: pos.value > x ? 'rgba(255,255,255,0.35)' : off }));
  return <Animated.View style={[styles.dot, { left: x - DOT / 2 }, style]} />;
}

const styles = StyleSheet.create({
  label: { fontSize: 24, fontWeight: '600', textAlign: 'center', marginBottom: 18 },
  track: { height: HEIGHT, borderRadius: HEIGHT / 2, borderWidth: StyleSheet.hairlineWidth },
  fillClip: {
    position: 'absolute',
    left: PAD,
    top: PAD,
    height: FILL,
    borderRadius: FILL / 2,
    overflow: 'hidden',
  },
  fill: { height: FILL, borderRadius: FILL / 2 },
  dot: { position: 'absolute', top: (HEIGHT - DOT) / 2, width: DOT, height: DOT, borderRadius: DOT / 2 },
  knob: {
    position: 'absolute',
    left: 0,
    top: (HEIGHT - KNOB) / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
  },
});
