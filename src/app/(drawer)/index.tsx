import { router, useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { EmptyState } from '@/components/EmptyState';
import { MessageList } from '@/components/MessageList';
import { ModelPicker } from '@/components/ModelPicker';
import { regenerate, sendMessage, stopStreaming } from '@/lib/chat';
import type { ImagePart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useChats } from '@/store/chats';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';

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

  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
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

      <KeyboardAvoidingView style={styles.container} behavior="padding">
        {messages.length > 0 ? (
          <MessageList messages={messages} onRegenerate={onRegenerate} />
        ) : (
          <EmptyState
            hasEndpoint={hasEndpoint}
            onSuggestion={setDraft}
            onAddEndpoint={() => router.push('/settings/endpoint')}
          />
        )}
        <View style={{ paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 8), paddingTop: 4 }}>
          <Composer
            text={draft}
            onChangeText={setDraft}
            streaming={streaming}
            onSend={send}
            onStop={() => currentId && stopStreaming(currentId)}
          />
        </View>
      </KeyboardAvoidingView>

      <ModelPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onManage={() => router.push('/settings')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
