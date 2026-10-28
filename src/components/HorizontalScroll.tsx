import { useContext, useMemo, type ReactNode } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

/**
 * A sideways scroller for content wider than the screen (code, tables). The drawer opens on a
 * horizontal swipe across half the screen, which would otherwise take the swipe first, so the
 * drawer waits for this scroller to pass on the touch.
 */
export function HorizontalScroll({ children, style, contentContainerStyle }: Props) {
  // Typed as the new gesture API's PanGesture, but the drawer builds it with the legacy one.
  const drawer = useContext(DrawerGestureContext) as unknown as GestureType | undefined;
  const native = useMemo(() => {
    const gesture = Gesture.Native();
    return drawer ? gesture.blocksExternalGesture(drawer) : gesture;
  }, [drawer]);

  return (
    <GestureDetector gesture={native}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={style}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </ScrollView>
    </GestureDetector>
  );
}
