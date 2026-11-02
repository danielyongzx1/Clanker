import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ReactNode } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onAsk: (event: { nativeEvent: { text: string } }) => void;
};

/**
 * Adds "Ask Clanker" to the selection toolbar of selectable text inside it; picking it sends the
 * selected text as onAsk. Null on iOS and in builds made before this module was added.
 */
export const AskSelection = requireOptionalNativeModule('ClankerSelection')
  ? requireNativeView<Props>('ClankerSelection')
  : null;

if (__DEV__ && Platform.OS === 'android' && !AskSelection) {
  console.warn('ClankerSelection is missing from this build, so selected chat text has no Ask Clanker. Rebuild the app (npx expo run:android).');
}
