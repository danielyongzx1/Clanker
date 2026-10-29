import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { ChatHeader } from '@/components/ChatHeader';
import { composerGrowth } from '@/components/Composer';
import { COMPOSER_FADE, ComposerDock } from '@/components/ComposerDock';
import { EdgeFade } from '@/components/EdgeFade';
import { EmptyState } from '@/components/EmptyState';
import { MessageList } from '@/components/MessageList';
import { ModelPicker } from '@/components/ModelPicker';
import { regenerate, stopStreaming, submitMessage } from '@/lib/chat';
import type { AttachmentPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useContextUsage } from '@/lib/usage';
import { useChats } from '@/store/chats';
import { useProjects } from '@/store/projects';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';

// How far the header fade reaches past its controls into the conversation.
const HEADER_FADE = 16;

/** Shows Settings when sending fails for want of a model. */
export function reportSendError(e: unknown) {
  Alert.alert('No model selected', e instanceof Error ? e.message : String(e), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open Settings', onPress: () => router.push('/settings') },
  ]);
}

/**
 * The chat on screen (store/ui currentId), or the new-chat state. The main one sits in the drawer
 * and opens it from the header; a project's chat is pushed over the project page and goes back
 * to it instead.
 */
export function ChatScreen({ onMenu, onBack }: { onMenu?: () => void; onBack?: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const currentId = useUI((s) => s.currentId);
  const open = useUI((s) => s.open);
  // Only what this screen shows itself. MessageList reads the messages, so a streaming reply
  // re-renders the list rather than the header and composer with every token.
  const conversation = useChats(
    useShallow((s) => {
      const c = currentId ? s.conversations[currentId] : undefined;
      return c
        ? {
            memory: c.memory,
            projectId: c.projectId,
            empty: c.messages.length === 0,
            streaming: c.messages.some((m) => m.status === 'streaming'),
          }
        : undefined;
    })
  );
  const active = useSettings((s) => s.active);
  const hasEndpoint = useSettings((s) => s.endpoints.some((e) => e.models.length > 0));
  const showUsage = useSettings((s) => s.contextUsage);
  const usage = useContextUsage(currentId, showUsage);
  const memorySetting = useSettings((s) => s.memory);
  const newChatMemoryOff = useUI((s) => s.newChatMemoryOff);
  const memoryOff = memorySetting && (conversation ? conversation.memory === false : newChatMemoryOff);
  const newChatProjectId = useUI((s) => s.newChatProjectId);
  const projectId = conversation ? conversation.projectId : newChatProjectId;
  const projectName = useProjects((s) => (projectId ? s.projects[projectId]?.name : undefined));

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

  const streaming = !!conversation?.streaming;

  // Reopening a chat switches back to the model it was using, as ChatGPT does.
  useEffect(() => {
    const conversation = currentId ? useChats.getState().conversations[currentId] : undefined;
    if (!conversation) return;
    const { endpoints, setActive } = useSettings.getState();
    const endpoint = endpoints.find((e) => e.id === conversation.endpointId);
    if (endpoint?.models.includes(conversation.model)) {
      setActive({ endpointId: endpoint.id, model: conversation.model });
    }
  }, [currentId]);

  const send = useCallback(
    (text: string, attachments: AttachmentPart[]) => {
      try {
        // While a reply runs, this queues the message or steers the reply with it.
        const id = submitMessage(currentId, text, attachments);
        if (id !== currentId) open(id);
        setDraft('');
      } catch (e) {
        reportSendError(e);
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* With KeyboardProvider mounted the Android window no longer resizes for the keyboard,
          so both platforms pad from the keyboard height. */}
      <KeyboardAvoidingView style={styles.container} behavior="padding">
        {/* An unpadded box, so the composer's absolute position isn't thrown off by the
            avoiding view's keyboard padding. */}
        <View style={styles.container}>
          {currentId && conversation && !conversation.empty ? (
            <MessageList
              conversationId={currentId}
              onRegenerate={onRegenerate}
              topInset={topInset}
              bottomInset={bottomInset}
            />
          ) : (
            <Animated.View style={[styles.container, { paddingTop: topInset }, emptyInsetStyle]}>
              <EmptyState
                hasEndpoint={hasEndpoint}
                memoryOff={memoryOff}
                project={projectName}
                onSuggestion={setDraft}
                onAddEndpoint={() => router.push('/settings/endpoint')}
              />
            </Animated.View>
          )}
          <ComposerDock
            conversationId={currentId}
            draft={draft}
            onChangeDraft={setDraft}
            streaming={streaming}
            onSend={send}
            onStop={() => currentId && stopStreaming(currentId)}
            usage={usage}
            progress={composerProgress}
            onBaseHeight={setComposerBase}
          />
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
          onMenu={onMenu}
          onBack={onBack}
          onTitle={() => setPickerOpen(true)}
          onNewChat={
            currentId
              ? () => (conversation?.projectId ? useUI.getState().openNewInProject(conversation.projectId) : open(null))
              : undefined
          }
          memoryOff={memoryOff}
          onToggleMemory={
            !currentId && memorySetting ? () => useUI.getState().setNewChatMemoryOff(!newChatMemoryOff) : undefined
          }
        />
      </View>

      <ModelPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onManage={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerArea: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: HEADER_FADE },
});
