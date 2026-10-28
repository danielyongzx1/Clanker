import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

// Eased opacity ramp (0 → 1); a linear one shows a visible edge where it meets solid colour.
const EASE = [0, 0.06, 0.2, 0.42, 0.66, 0.86, 1];

type Props = {
  // The edge that is fully background-coloured; the fade runs out toward the other one.
  solid: 'top' | 'bottom';
  style?: StyleProp<ViewStyle>;
};

// A wash of the background colour that fades content scrolling underneath it, as ChatGPT
// does under its header and composer.
export function EdgeFade({ solid, style }: Props) {
  const { colors } = useTheme();
  const id = `fade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Stops must run in ascending offset order, so a solid top walks the ramp backwards.
  const ramp = solid === 'bottom' ? EASE : [...EASE].reverse();
  const last = ramp.length - 1;

  return (
    <View pointerEvents="none" style={style}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {ramp.map((o, i) => (
              <Stop key={i} offset={i / last} stopColor={colors.background} stopOpacity={o} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
