import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, View, type TextInputInstance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OverKeyboardView } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useShallow } from 'zustand/react/shallow';
import { deleteQueued, sendQueuedNow, takeQueued } from '@/lib/chat';
import type { AttachmentPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import type { ContextUsage } from '@/lib/usage';
import { useChats } from '@/store/chats';
import { resolveEffort, useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { Composer, composerGrowth } from './Composer';
import { EdgeFade } from './EdgeFade';
import { EffortSlider } from './EffortSlider';
import { QueuedMessages } from './QueuedMessages';

// Effort panel backdrop: a solid wash of background from just above the label down to the
// screen bottom, with a fade of VEIL_FADE above it, so text behind the panel drops out.
const VEIL_CAP = 26;
const VEIL_FADE = 120;
const EFFORT_FADE = { duration: 160 };
/** How far the composer's fade reaches past it into the content above. */
export const COMPOSER_FADE = 28;

// Keeps the keyboard height so the over-keyboard effort panel can sit just above it.
function useKeyboard() {
  const [state, setState] = useState({ visible: false, height: 0 });
  useEffect(() => {
    const show = (height: number) => setState({ visible: true, height });
    const showWill = Keyboard.addListener('keyboardWillShow', (e) => show(e.endCoordinates.height));
    const showDid = Keyboard.addListener('keyboardDidShow', (e) => show(e.endCoordinates.height));
    const hide = () => setState((s) => ({ visible: false, height: s.height }));
    const hideWill = Keyboard.addListener('keyboardWillHide', hide);
    const hideDid = Keyboard.addListener('keyboardDidHide', hide);
    return () => [showWill, showDid, hideWill, hideDid].forEach((s) => s.remove());
  }, []);
  return state;
}

type Props = {
  /** The chat it sends to, whose queued messages show above the box; none for a chat yet to start. */
  conversationId?: string | null;
  draft: string;
  onChangeDraft: (text: string) => void;
  streaming: boolean;
  onSend: (text: string, attachments: AttachmentPart[]) => void;
  onStop: () => void;
  usage: ContextUsage | null;
  /** The composer's expansion; the screen reads it to keep content clear of the growing box. */
  progress: SharedValue<number>;
  /** The dock's height with the composer collapsed, its fade included, whenever it settles. */
  onBaseHeight: (height: number) => void;
};

/**
 * The composer floating at the bottom of a screen, with the effort slider that cross-fades with
 * it. Place it inside the screen's keyboard-avoiding box, over the content it fades out.
 */
export function ComposerDock({
  conversationId,
  draft,
  onChangeDraft,
  streaming,
  onSend,
  onStop,
  usage,
  progress,
  onBaseHeight,
}: Props) {
  const { colors } = useTheme();
  const [attachments, setAttachments] = useState<AttachmentPart[]>([]);
  const input = useRef<TextInputInstance>(null);
  const queue = useChats((s) => (conversationId ? s.conversations[conversationId]?.queue : undefined));
  const followUp = useSettings((s) => s.followUp);
  const insets = useSafeAreaInsets();
  const active = useSettings((s) => s.active);
  const effort = useSettings(useShallow((s) => resolveEffort(s, s.active)));
  const effortOpen = useUI((s) => s.effortOpen);
  const setEffortOpen = useUI((s) => s.setEffortOpen);
  // Screens under the one on top keep their dock mounted; only the visible one shows the slider.
  const focused = useIsFocused();
  const showEffort = focused && effortOpen && !!effort;
  const keyboard = useKeyboard();
  const keyboardVisible = keyboard.visible;

  // The slider lives in an over-keyboard layer (its own window on top of the IME), so the
  // keyboard stays up underneath it, the veil paints across it, and every touch hits the
  // layer's scrim instead of a key. If the system dismisses the keyboard anyway (back
  // gesture), that layer can go down with it, so close the slider to match. The layer can
  // itself make the IME blink on mount, so a dismissal right as it appears is ignored.
  const overlayAppearedAt = useRef(0);
  useEffect(() => {
    if (!showEffort) return;
    overlayAppearedAt.current = Date.now();
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (Date.now() - overlayAppearedAt.current > 400) setEffortOpen(false);
    });
    return () => hide.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEffort]);

  // The panel cross-fades with the composer both ways. The over-keyboard layer stays up until
  // the fade-out finishes; hiding it with the slider would cut the panel off mid-fade.
  const effortFade = useSharedValue(0);
  const [effortMounted, setEffortMounted] = useState(false);
  if (showEffort && !effortMounted) setEffortMounted(true);
  useEffect(() => {
    if (showEffort) {
      effortFade.set(withTiming(1, EFFORT_FADE));
      return;
    }
    effortFade.set(
      withTiming(0, EFFORT_FADE, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(setEffortMounted, false);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEffort]);
  const effortStyle = useAnimatedStyle(() => ({ opacity: effortFade.value }));
  const composerStyle = useAnimatedStyle(() => ({ opacity: 1 - effortFade.value }));

  // Editing brings a queued message back into the box, after anything already being written there.
  const editQueued = (id: string) => {
    const message = conversationId && takeQueued(conversationId, id);
    if (!message) return;
    onChangeDraft([draft.trimEnd(), message.text].filter(Boolean).join('\n\n'));
    setAttachments((prev) => [...prev, ...message.attachments]);
    input.current?.focus();
  };
  const sendNow = (id: string) => {
    if (!conversationId) return;
    try {
      sendQueuedNow(conversationId, id);
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : String(e));
    }
  };

  const panelBottom = keyboardVisible ? keyboard.height + 8 : Math.max(insets.bottom, 8);
  const bottomPad = keyboardVisible ? 8 : Math.max(insets.bottom, 8);

  return (
    <>
      {/* Floats over the bottom of the content; what scrolls under it fades out into the
          background instead of being cut off at a hard edge. */}
      <View
        pointerEvents="box-none"
        onLayout={(e) => {
          // Mid-animation sizes race the UI thread; the layout after it settles is exact.
          const p = progress.get();
          if (p > 0 && p < 1) return;
          onBaseHeight(Math.round(e.nativeEvent.layout.height - composerGrowth(p)));
        }}
        style={[styles.area, { paddingBottom: bottomPad }]}
      >
        <EdgeFade solid="bottom" style={StyleSheet.absoluteFill} />
        {/* Faded out rather than unmounted while the slider is up, so attached images survive,
            and untouchable as a backstop in case the overlay window mounts a beat late. */}
        <Animated.View style={composerStyle} pointerEvents={showEffort ? 'none' : 'auto'}>
          {conversationId && queue?.length ? (
            <QueuedMessages
              messages={queue}
              streaming={streaming}
              progress={progress}
              onEdit={editQueued}
              onDelete={(id) => deleteQueued(conversationId, id)}
              onSendNow={sendNow}
            />
          ) : null}
          <Composer
            text={draft}
            onChangeText={onChangeDraft}
            attachments={attachments}
            onChangeAttachments={setAttachments}
            placeholder={streaming ? (followUp === 'steer' ? 'Steer the reply' : 'Queue a follow-up') : 'Ask anything'}
            inputRef={input}
            streaming={streaming}
            onSend={onSend}
            onStop={onStop}
            keyboardVisible={keyboardVisible}
            effort={effort ? { ...effort, onPress: () => setEffortOpen(true) } : undefined}
            context={usage}
            progress={progress}
          />
        </Animated.View>
      </View>

      {/* The layer floats above the keyboard window, so the keyboard keeps showing under the
          veil and stays untouched: every tap lands on this layer's scrim. */}
      <OverKeyboardView visible={effortMounted}>
        <GestureHandlerRootView style={styles.overlay}>
          {effortMounted && (
            // Transparent: it only catches taps. The veil gradients below do the visual work,
            // so the header and content above the fade stay undimmed, as in ChatGPT.
            <Pressable style={styles.scrim} onPress={() => setEffortOpen(false)} accessibilityLabel="Close effort" />
          )}
          {effortMounted && effort && (
            // A full-width column from the top of the fade to the screen bottom. Every veil
            // piece lies inside it: Android dropped most of the pieces that used to hang
            // outside the panel's bounds while the keyboard was up, leaving a strip at the left.
            <Animated.View pointerEvents={showEffort ? 'box-none' : 'none'} style={[styles.effort, effortStyle]}>
              {/* Content fades out into solid background just above the label. */}
              <EdgeFade solid="bottom" style={styles.veilFade} />
              {/* Solid behind the label and slider; without a keyboard it runs flush to the
                  screen bottom. */}
              <View
                pointerEvents="box-none"
                style={[
                  styles.panel,
                  { backgroundColor: colors.background, paddingBottom: keyboardVisible ? 0 : panelBottom },
                ]}
              >
                <EffortSlider
                  levels={effort.levels}
                  value={effort.level}
                  onChange={(level) => active && useSettings.getState().setEffort(active, level)}
                />
              </View>
              {/* Over the keyboard the veil keeps going as a gradient — solid just below the
                  slider, washing out toward the bottom of the screen so the keys emerge from
                  it, as in ChatGPT. */}
              {keyboardVisible && <EdgeFade solid="top" style={{ height: panelBottom }} />}
            </Animated.View>
          )}
        </GestureHandlerRootView>
      </OverKeyboardView>
    </>
  );
}

const styles = StyleSheet.create({
  area: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: COMPOSER_FADE },
  // The overlay host is stretched to the full screen by its native side; children fill it.
  overlay: { flex: 1 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  effort: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  veilFade: { height: VEIL_FADE },
  panel: { paddingHorizontal: 28, paddingTop: VEIL_CAP },
});
