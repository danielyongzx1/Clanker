import { requireNativeView, requireOptionalNativeModule, type NativeModule } from 'expo';
import type { ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

type Events = { onAsk: (event: { text: string }) => void };

declare class ClankerSelectionModule extends NativeModule<Events> {}

const ClankerSelection = requireOptionalNativeModule<ClankerSelectionModule>('ClankerSelection');

/**
 * Text inside is selected as one stretch, across paragraphs and blocks, with "Ask Clanker" on its
 * toolbar. The text views inside must not be selectable themselves. Null on iOS and in builds made
 * before this module was added.
 */
export const SelectionScope = ClankerSelection
  ? requireNativeView<{ children: ReactNode; style?: StyleProp<ViewStyle> }>('ClankerSelection')
  : null;

/** The nativeID that leaves a view (a label, a button) and everything in it out of selections. */
export const SKIP_SELECTION = 'clanker-selection-skip';

/** Calls back with the text the user picks "Ask Clanker" for; returns the unsubscribe. */
export function addAskListener(listener: (text: string) => void) {
  const subscription = ClankerSelection?.addListener('onAsk', (e) => listener(e.text));
  return () => subscription?.remove();
}

if (__DEV__ && Platform.OS === 'android' && !SelectionScope) {
  console.warn('ClankerSelection is missing from this build, so chat text selects a paragraph at a time with no Ask Clanker. Rebuild the app (npx expo run:android).');
}
