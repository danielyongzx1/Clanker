import * as Haptics from 'expo-haptics';

export { ImpactFeedbackStyle } from 'expo-haptics';

/**
 * Haptics are decoration, so these never reject: a binary built without the native module, or a
 * device that can't vibrate, simply stays still instead of surfacing an unhandled rejection.
 */
export function selectionAsync() {
  return Haptics.selectionAsync().catch(() => {});
}

export function impactAsync(style?: Haptics.ImpactFeedbackStyle) {
  return Haptics.impactAsync(style).catch(() => {});
}
