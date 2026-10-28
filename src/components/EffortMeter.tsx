import { Circle, Line, Path, Svg } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

// Gauge for the composer's effort button: an arc that fills clockwise in proportion to the
// level's position in the model's range, so the meter reads fuller the harder the model is
// set to think, with a speedometer needle on the current level. `off`/`none` show an empty
// track with the needle parked at the start.
const SIZE = 24;
const C = SIZE / 2;
const R = 8.25;
const STROKE = 2.4;
const NEEDLE = R - STROKE;
const START = -135;
const SWEEP = 270;

/** A point on the gauge, `deg` clockwise from 12 o'clock, at radius `r`. */
function point(deg: number, r = R) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
}

function arcPath(from: number, to: number) {
  const a = point(from);
  const b = point(to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function EffortMeter({ levels, level, size = SIZE }: { levels: string[]; level: string; size?: number }) {
  const { colors } = useTheme();
  const index = Math.max(0, levels.indexOf(level));
  // Segment per level: the lowest active level is a third full on a three-level model,
  // the highest always reaches the end. Off is empty at any position in the range.
  const frac = level === 'off' || level === 'none' ? 0 : (index + 1) / levels.length;
  const needle = point(START + SWEEP * frac, NEEDLE);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      <Path
        d={arcPath(START, START + SWEEP)}
        fill="none"
        stroke={colors.textTertiary}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      {frac > 0 && (
        <Path d={arcPath(START, START + SWEEP * frac)} fill="none" stroke={colors.accent} strokeWidth={STROKE} strokeLinecap="round" />
      )}
      <Line
        x1={C}
        y1={C}
        x2={needle.x}
        y2={needle.y}
        stroke={colors.text}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Circle cx={C} cy={C} r={1.7} fill={colors.text} />
    </Svg>
  );
}
