import { router, useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Defs, LinearGradient, Rect, Stop, Svg } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { EffortSlider } from '@/components/EffortSlider';
import { EmptyState } from '@/components/EmptyState';
import { MessageList } from '@/components/MessageList';
import { ModelPicker } from '@/components/ModelPicker';
import { regenerate, sendMessage, stopStreaming } from '@/lib/chat';
import type { ImagePart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useChats } from '@/store/chats';
import { resolveEffort, useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';

// Effort panel backdrop: a solid wash of background from just above the label down to the
// screen bottom, with a fade of VEIL_FADE above it, so text behind the panel drops out.
const VEIL_CAP = 26;
const VEIL_FADE = 96;

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setVisible(true));
    const showAndroid = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setVisible(false));
    const hideAndroid = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => [show, showAndroid, hide, hideAndroid].forEach((s) => s.remove());
  }, []);
  return visible;
}

export default function ChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DrawerNavigationProp<Record<string, undefined>>>();
  const keyboardVisible = useKeyboardVisible();

  const currentId = useUI((s) => s.currentId);
  const open = useUI((s) => s.open);
  const conversation = useChats((s) => (currentId ? s.conversations[currentId] : undefined));
  const active = useSettings((s) => s.active);
  const hasEndpoint = useSettings((s) => s.endpoints.some((e) => e.models.length > 0));
  const effort = useSettings(useShallow((s) => resolveEffort(s, s.active)));

  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const effortOpen = useUI((s) => s.effortOpen);
  const setEffortOpen = useUI((s) => s.setEffortOpen);
  const showEffort = effortOpen && !!effort;
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
    (text: string, images: ImagePart[]) => {
      try {
        const id = sendMessage(currentId, text, images);
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
      <ChatHeader
        title={active?.model ?? 'Clanker'}
        onMenu={() => {
          Keyboard.dismiss();
          navigation.openDrawer();
        }}
        onTitle={() => setPickerOpen(true)}
        onNewChat={currentId ? () => open(null) : undefined}
      />

      {/* Android already resizes the window for the keyboard; padding on top of that pushes the
          content up twice until the next layout pass snaps it back down. */}
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.length > 0 ? (
          <MessageList messages={messages} onRegenerate={onRegenerate} />
        ) : (
          <EmptyState
            hasEndpoint={hasEndpoint}
            onSuggestion={setDraft}
            onAddEndpoint={() => router.push('/settings/endpoint')}
          />
        )}
        {showEffort && (
          <Pressable
            style={[styles.scrim, { backgroundColor: colors.overlay }]}
            onPress={() => setEffortOpen(false)}
            accessibilityLabel="Close effort"
          />
        )}
        <View style={{ paddingBottom: bottomPad, paddingTop: 4 }}>
          {/* Hidden rather than unmounted while the slider is up, so attached images survive. */}
          <View style={showEffort && styles.hidden} pointerEvents={showEffort ? 'none' : 'auto'}>
            <Composer
              text={draft}
              onChangeText={setDraft}
              streaming={streaming}
              onSend={send}
              onStop={() => currentId && stopStreaming(currentId)}
              effort={effort ? { ...effort, onPress: () => setEffortOpen(true) } : undefined}
            />
          </View>
          {showEffort && effort && (
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              style={[styles.effort, { bottom: bottomPad }]}
            >
              {/* Gradient veil so the label and slider sit on a clean backdrop over the
                  dimmed content: fades to solid background just above the label and extends
                  to the screen bottom, flush with both edges of the screen. */}
              <View
                pointerEvents="none"
                style={[styles.veilSolid, { backgroundColor: colors.background, bottom: -bottomPad, top: -VEIL_CAP }]}
              />
              <Svg pointerEvents="none" style={[styles.veilFade, { top: -(VEIL_CAP + VEIL_FADE) }]}>
                <Defs>
                  <LinearGradient id="effortVeil" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
                    <Stop offset="1" stopColor={colors.background} stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#effortVeil)" />
              </Svg>
              <EffortSlider
                levels={effort.levels}
                value={effort.level}
                onChange={(level) => active && useSettings.getState().setEffort(active, level)}
              />
            </Animated.View>
          )}
        </View>
      </KeyboardAvoidingView>

      <ModelPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onManage={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hidden: { opacity: 0 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  effort: { position: 'absolute', left: 28, right: 28 },
  veilSolid: { position: 'absolute', left: -28, right: -28 },
  veilFade: { position: 'absolute', left: -28, right: -28, height: VEIL_FADE },
});
