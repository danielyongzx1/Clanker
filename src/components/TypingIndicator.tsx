import { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

/** The pulsing dot ChatGPT shows before the first token arrives. */
export function TypingIndicator() {
  const { colors } = useTheme();
  const scale = useSharedValue(0.75);

  useEffect(() => {
    scale.value = withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: scale.value }));

  return (
    <Animated.View
      style={[{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.text, marginVertical: 8 }, style]}
    />
  );
}
