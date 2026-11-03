import { createContext, useContext, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SelectionScope } from '../../modules/clanker-selection';

const InArea = createContext(false);

/** Whether areas select their text themselves, so the Text in them mustn't be selectable. */
export const areasSelect = !!SelectionScope;

/**
 * Chat text the user can select across paragraphs, code and lists in one go, with "Ask Clanker"
 * beside Copy. Where the native selection isn't in the build, each Text selects on its own.
 */
export function SelectionArea({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (!SelectionScope) return <View style={style}>{children}</View>;
  return (
    <InArea.Provider value>
      <SelectionScope style={style}>{children}</SelectionScope>
    </InArea.Provider>
  );
}

/** Whether a Text selects natively: not inside a selection area, which selects for it. */
export function useSelectable() {
  return !useContext(InArea);
}
