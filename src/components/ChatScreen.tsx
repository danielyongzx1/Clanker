import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';
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
import { brandOfBackendKind, brandOfModel, friendlyModelName } from '@/lib/modelNames';
import type { AttachmentPart } from '@/lib/providers';
import { withQuotes } from '@/lib/quotes';
import { useTheme } from '@/lib/theme';
import { useContextUsage } from '@/lib/usage';
import { useChats } from '@/store/chats';
import { useProjects } from '@/store/projects';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { useBackends } from '@/store/backends';
import { refreshRemoteBackend, resumeRemoteChat } from '@/lib/remote/chat';

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
            backendId: c.backendId ?? 'local',
            model: c.model,
            pendingRemote: !!c.remote?.submissionId,
            projectId: c.projectId,
            empty: c.messages.length === 0,
            streaming: c.messages.some((m) => m.status === 'streaming'),
          }
        : undefined;
    })
  );
  const active = useSettings((s) => s.active);
  const selectedBackend = useBackends((s) => s.selected);
  const backendId = conversation?.backendId ?? selectedBackend;
  const remote = backendId !== 'local';
  const backendName = useBackends((s) => s.remotes.find((b) => b.id === backendId)?.name ?? (backendId === 'local' ? 'Clanker' : 'Remote backend'));
  const remoteModel = useBackends((s) => s.remotes.find((b) => b.id === backendId)?.model);
  const hasEndpoint = useSettings((s) => s.endpoints.some((e) => e.models.length > 0));
  const friendly = useSettings((s) => s.friendlyModelNames);
  const showUsage = useSettings((s) => s.contextUsage);
  const usage = useContextUsage(currentId, showUsage);
  const memorySetting = useSettings((s) => s.memory);
  const backendKind = useBackends((s) => s.remotes.find((b) => b.id === backendId)?.kind);
  const newChatMemoryOff = useUI((s) => s.newChatMemoryOff);
  const memoryOff = !remote && memorySetting && (conversation ? conversation.memory === false : newChatMemoryOff);
  const newChatProjectId = useUI((s) => s.newChatProjectId);
  const projectId = conversation ? conversation.projectId : newChatProjectId;
  const projectName = useProjects((s) => (projectId ? s.projects[projectId]?.name : undefined));

  const [draft, setDraft] = useState('');
  // Text picked from the chat with "Ask Clanker", sent as quotes ahead of the next message.
  const [quotes, setQuotes] = useState<string[]>([]);
  const addQuote = useCallback((text: string) => setQuotes((prev) => (prev.includes(text) ? prev : [...prev, text])), []);
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

  const streaming = !!conversation?.streaming || !!conversation?.pendingRemote;
  useEffect(() => {
    if (!remote) return;
    void refreshRemoteBackend(backendId).catch(() => {});
  }, [backendId, remote]);
  useEffect(() => {
    if (!currentId || !remote) return;
    void resumeRemoteChat(currentId);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void resumeRemoteChat(currentId); });
    return () => listener.remove();
  }, [currentId, remote]);

  // Reopening a chat switches back to the model it was using, as ChatGPT does.
  useEffect(() => {
    const conversation = currentId ? useChats.getState().conversations[currentId] : undefined;
    if (!conversation || (conversation.backendId && conversation.backendId !== 'local')) return;
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
        const id = submitMessage(currentId, withQuotes(quotes, text), attachments);
        if (id !== currentId) open(id);
        setDraft('');
        setQuotes([]);
      } catch (e) {
        reportSendError(e);
      }
    },
    [currentId, open, quotes]
  );

  const onRegenerate = useCallback(
    (messageId: string) => {
      if (currentId && !streaming) regenerate(currentId, messageId);
    },
    [currentId, streaming]
  );

  // The header title: raw ids, or with friendly names the brand mark plus a tidied model name.
  // A remote chat carries its backend's mark (Hermes / DeepSeek Harness); local ones carry none.
  const rawTitle = remote ? (conversation?.model ?? remoteModel ?? backendName) : (active?.model ?? 'Clanker');
  const title = friendly && rawTitle !== 'Clanker' && rawTitle !== backendName ? friendlyModelName(rawTitle) || rawTitle : rawTitle;
  const titleBrand = friendly ? (remote ? (backendKind ? brandOfBackendKind(backendKind) : undefined) : active ? brandOfModel(active.model) : undefined) : undefined;

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
              onRegenerate={remote ? undefined : onRegenerate}
              onAsk={addQuote}
              topInset={topInset}
              bottomInset={bottomInset}
            />
          ) : (
            <Animated.View style={[styles.container, { paddingTop: topInset }, emptyInsetStyle]}>
              <EmptyState
                hasEndpoint={remote ? !!remoteModel : hasEndpoint}
                remote={remote ? backendName : undefined}
                remoteBrand={remote && friendly && backendKind ? brandOfBackendKind(backendKind) : undefined}
                memoryOff={memoryOff}
                project={projectName}
                onSuggestion={setDraft}
                onAddEndpoint={() =>
                  router.push(remote ? { pathname: '/settings/backend', params: { id: backendId } } : '/settings/endpoint')
                }
              />
            </Animated.View>
          )}
          <ComposerDock
            conversationId={currentId}
            draft={draft}
            onChangeDraft={setDraft}
            quotes={quotes}
            onChangeQuotes={setQuotes}
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
          title={title}
          onMenu={onMenu}
          onBack={onBack}
          onTitle={() => setPickerOpen(true)}
          backend={remote ? backendName : undefined}
          brand={titleBrand}
          onNewChat={
            currentId
              ? () => (conversation?.projectId ? useUI.getState().openNewInProject(conversation.projectId) : open(null))
              : undefined
          }
          memoryOff={memoryOff}
          onToggleMemory={
            !currentId && memorySetting && !remote ? () => useUI.getState().setNewChatMemoryOff(!newChatMemoryOff) : undefined
          }
        />
      </View>

      <ModelPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} conversationId={currentId} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerArea: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: HEADER_FADE },
});
