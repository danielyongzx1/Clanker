import { useRef, type ReactNode } from 'react';
import {
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { InvertedScrollRelay } from '../../modules/clanker-scroll';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Keeps the end in view as the content grows, until the user drags away; dragging back to the end picks it up again. */
  follow?: boolean;
};

/**
 * A height-capped vertical scroller for content inside a chat message (thoughts, tool output).
 * Past its ends a drag carries on into the chat, which is an inverted list; on Android that would
 * run the chat backwards without the relay around it.
 */
export function NestedScroll({ children, style, contentContainerStyle, follow = false }: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const pinned = useRef(true);
  const settle = ({ nativeEvent: e }: NativeSyntheticEvent<NativeScrollEvent>) => {
    pinned.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 24;
  };

  const box = (
    <ScrollView
      ref={scroll}
      nestedScrollEnabled
      style={style}
      contentContainerStyle={contentContainerStyle}
      onContentSizeChange={() => follow && pinned.current && scroll.current?.scrollToEnd({ animated: false })}
      onScrollBeginDrag={() => (pinned.current = false)}
      onScrollEndDrag={settle}
      onMomentumScrollEnd={settle}
    >
      {children}
    </ScrollView>
  );
  return InvertedScrollRelay ? <InvertedScrollRelay>{box}</InvertedScrollRelay> : box;
}
