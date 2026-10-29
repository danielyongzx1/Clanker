import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';

/**
 * Wraps a scroll view nested in an inverted list so that, past its ends, it scrolls the list the
 * way the finger moves. Null on iOS (which doesn't hand scrolls on) and in builds made before this
 * module was added.
 */
export const InvertedScrollRelay = requireOptionalNativeModule('ClankerScroll')
  ? requireNativeView<{ children: ReactNode }>('ClankerScroll')
  : null;

if (__DEV__ && Platform.OS === 'android' && !InvertedScrollRelay) {
  console.warn('ClankerScroll is missing from this build, so boxes in the chat scroll it backwards past their ends. Rebuild the app (npx expo run:android).');
}
