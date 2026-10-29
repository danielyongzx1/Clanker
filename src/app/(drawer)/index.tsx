import { router, useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardAvoidingView, OverKeyboardView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer, composerGrowth } from '@/components/Composer';
import { EdgeFade } from '@/components/EdgeFade';
import { EffortSlider } from '@/components/EffortSlider';
import { EmptyState } from '@/components/EmptyState';
import { MessageList } from '@/components/MessageList';
import { ModelPicker } from '@/components/ModelPicker';
import { regenerate, sendMessage, stopStreaming } from '@/lib/chat';
import type { AttachmentPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useContextUsage } from '@/lib/usage';
import { useChats } from '@/store/chats';
import { resolveEffort, useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';

// Effort panel backdrop: a solid wash of background from just above the label down to the
// screen bottom, with a fade of VEIL_FADE above it, so text behind the panel drops out.
const VEIL_CAP = 26;
const VEIL_FADE = 120;
const EFFORT_FADE = { duration: 160 };
// How far the header and composer fades reach past their controls into the conversation.
const HEADER_FADE = 16;
const COMPOSER_FADE = 28;

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

export default function ChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DrawerNavigationProp<Record<string, undefined>>>();

  const currentId = useUI((s) => s.currentId);
  const open = useUI((s) => s.open);
  const conversation = useChats((s) => (currentId ? s.conversations[currentId] : undefined));
  const active = useSettings((s) => s.active);
  const hasEndpoint = useSettings((s) => s.endpoints.some((e) => e.models.length > 0));
  const effort = useSettings(useShallow((s) => resolveEffort(s, s.active)));
  const showUsage = useSettings((s) => s.contextUsage);
  const usage = useContextUsage(currentId, showUsage);

  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // The conversation runs under the floating header and composer; these are their measured
  // heights (fade included) so content can rest clear of them. The composer's is measured
  // collapsed, and its growth while expanding is added on the UI thread: measuring it every
  // frame re-rendered the whole screen per frame and tanked the animation.
  const [headerHeight, setHeaderHeight] = useState(insets.top + 60 + HEADER_FADE);
  const [composerBase, setComposerBase] = useState(0);
  const composerProgress = useSharedValue(0);
  const topInset = headerHeight - HEADER_FADE;
  const bottomInset = useDerivedValue(() =>
    Math.max(composerBase + composerGrowth(composerProgress.value) - COMPOSER_FADE, 0)
  );
  const emptyInsetStyle = useAnimatedStyle(() => ({ paddingBottom: bottomInset.value }));
  const effortOpen = useUI((s) => s.effortOpen);
  const setEffortOpen = useUI((s) => s.setEffortOpen);
  const showEffort = effortOpen && !!effort;
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

  const panelBottom = keyboardVisible ? keyboard.height + 8 : Math.max(insets.bottom, 8);
  const messages = conversation?.messages ?? [];
  const streaming = messages.some((m) => m.status === 'streaming');

  // Reopening a chat switches back to the model it was using, as ChatGPT does.
  useEffect(() => {
    if (!conversation) return;
    const { endpoints, setActive } = useSettings.getState();
    const endpoint = endpoints.find((e) => e.id === conversation.endpointId);
    if (endpoint?.models.includes(conversation.model)) {
      setActive({ endpointId: endpoint.id, model: conversation.model });
    }
    // Only when switching conversations, not on every message update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const send = useCallback(
    (text: string, attachments: AttachmentPart[]) => {
      try {
        const id = sendMessage(currentId, text, attachments);
        if (id !== currentId) open(id);
        setDraft('');
      } catch (e) {
        Alert.alert('No model selected', e instanceof Error ? e.message : String(e), [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => router.push('/settings') },
        ]);
      }
    },
    [currentId, open]
  );

  const onRegenerate = useCallback(
    (messageId: string) => {
      if (currentId && !streaming) regenerate(currentId, messageId);
    },
    [currentId, streaming]
  );

  const bottomPad = keyboardVisible ? 8 : Math.max(insets.bottom, 8);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* With KeyboardProvider mounted the Android window no longer resizes for the keyboard,
          so both platforms pad from the keyboard height. */}
      <KeyboardAvoidingView style={styles.container} behavior="padding">
        {/* An unpadded box, so the composer's absolute position isn't thrown off by the
            avoiding view's keyboard padding. */}
        <View style={styles.container}>
          {messages.length > 0 ? (
            <MessageList
              messages={messages}
              onRegenerate={onRegenerate}
              topInset={topInset}
              bottomInset={bottomInset}
            />
          ) : (
            <Animated.View style={[styles.container, { paddingTop: topInset }, emptyInsetStyle]}>
              <EmptyState
                hasEndpoint={hasEndpoint}
                onSuggestion={setDraft}
                onAddEndpoint={() => router.push('/settings/endpoint')}
              />
            </Animated.View>
          )}
          {/* Floats over the bottom of the list; content scrolling under it fades out into the
              background instead of being cut off at a hard edge. */}
          <View
            pointerEvents="box-none"
            onLayout={(e) => {
              // Mid-animation sizes race the UI thread; the layout after it settles is exact.
              const p = composerProgress.get();
              if (p > 0 && p < 1) return;
              setComposerBase(Math.round(e.nativeEvent.layout.height - composerGrowth(p)));
            }}
            style={[styles.composerArea, { paddingBottom: bottomPad }]}
          >
            <EdgeFade solid="bottom" style={StyleSheet.absoluteFill} />
            {/* Faded out rather than unmounted while the slider is up, so attached images survive,
                and untouchable as a backstop in case the overlay window mounts a beat late. */}
            <Animated.View style={composerStyle} pointerEvents={showEffort ? 'none' : 'auto'}>
              <Composer
                text={draft}
                onChangeText={setDraft}
                streaming={streaming}
                onSend={send}
                onStop={() => currentId && stopStreaming(currentId)}
                keyboardVisible={keyboardVisible}
                effort={effort ? { ...effort, onPress: () => setEffortOpen(true) } : undefined}
                context={usage}
                progress={composerProgress}
              />
            </Animated.View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Floats over the top of the list, fading what scrolls beneath it, as in ChatGPT. */}
      <View
        pointerEvents="box-none"
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={styles.headerArea}
      >
        <EdgeFade solid="top" style={StyleSheet.absoluteFill} />
        <ChatHeader
          title={active?.model ?? 'Clanker'}
          onMenu={() => {
            Keyboard.dismiss();
            navigation.openDrawer();
          }}
          onTitle={() => setPickerOpen(true)}
          onNewChat={currentId ? () => open(null) : undefined}
        />
      </View>

      {/* The layer floats above the keyboard window, so the keyboard keeps showing under the
          veil and stays untouched: every tap lands on this layer's scrim. */}
      <OverKeyboardView visible={effortMounted}>
        <GestureHandlerRootView style={styles.overlay}>
          {effortMounted && (
            // Transparent: it only catches taps. The veil gradients below do the visual work,
            // so the header and content above the fade stay undimmed, as in ChatGPT.
            <Pressable
              style={styles.scrim}
              onPress={() => setEffortOpen(false)}
              accessibilityLabel="Close effort"
            />
          )}
          {effortMounted && effort && (
            // A full-width column from the top of the fade to the screen bottom. Every veil
            // piece lies inside it: Android dropped most of the pieces that used to hang
            // outside the panel's bounds while the keyboard was up, leaving a strip at the left.
            <Animated.View
              pointerEvents={showEffort ? 'box-none' : 'none'}
              style={[styles.effort, effortStyle]}
            >
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

      <ModelPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onManage={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // The overlay host is stretched to the full screen by its native side; children fill it.
  overlay: { flex: 1 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  effort: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  veilFade: { height: VEIL_FADE },
  headerArea: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: HEADER_FADE },
  composerArea: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: COMPOSER_FADE },
  panel: { paddingHorizontal: 28, paddingTop: VEIL_CAP },
});
