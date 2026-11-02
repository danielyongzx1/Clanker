import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useChatMenu } from '@/components/ChatMenu';
import { reportSendError } from '@/components/ChatScreen';
import { ComposerDock } from '@/components/ComposerDock';
import { FileList } from '@/components/FileList';
import { openProjectChat, useProjectMenu } from '@/components/ProjectMenu';
import { sendMessage } from '@/lib/chat';
import { addSources, SOURCES_DIR } from '@/lib/projects';
import type { AttachmentPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useContextUsage } from '@/lib/usage';
import { useChatLayer } from '@/lib/useChatLayer';
import { projectWorkspace } from '@/lib/workspace';
import { messageText, useChatList } from '@/store/chats';
import { useProjects } from '@/store/projects';
import { useSettings } from '@/store/settings';

type Tab = 'chats' | 'sources' | 'files';

const TABS: { key: Tab; label: string }[] = [
  { key: 'chats', label: 'Chats' },
  { key: 'sources', label: 'Sources' },
  { key: 'files', label: 'Files' },
];

// Room between the end of a list and the composer floating over it.
const LIST_GAP = 16;

/**
 * A project: its chats, the sources the user added, and the files in its workspace, with a
 * composer that starts a new chat in it.
 */
export default function ProjectScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  // While this page is up, the chat about to be started is one in this project.
  useChatLayer({ currentId: null, newChatProjectId: id });
  const project = useProjects((s) => s.projects[id]);
  const conversations = useChatList();
  const tools = useSettings((s) => s.tools);
  const [tab, setTab] = useState<Tab>('chats');
  const [added, setAdded] = useState(0);
  const { show, menu } = useProjectMenu({ onProjectPage: true, onDeleted: () => router.back() });
  const { show: showChatMenu, menu: chatMenu } = useChatMenu();
  const showArchived = useSettings((s) => s.showArchived);
  const workspace = useMemo(() => projectWorkspace(id), [id]);
  const showUsage = useSettings((s) => s.contextUsage);
  const usage = useContextUsage(null, showUsage);
  const [draft, setDraft] = useState('');
  const [composerBase, setComposerBase] = useState(0);
  const composerProgress = useSharedValue(0);
  // The keyboard's height, negative while it's up.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const keyboardPad = useAnimatedStyle(() => ({ paddingBottom: -keyboardHeight.value }));

  // Starts the chat here and shows it streaming, over this page.
  const send = useCallback(
    (text: string, attachments: AttachmentPart[]) => {
      try {
        const chatId = sendMessage(null, text, attachments);
        setDraft('');
        openProjectChat(id, chatId, true);
      } catch (e) {
        reportSendError(e);
      }
    },
    [id]
  );

  // Pinned chats first and archived ones (when shown at all) last, the latest first within each.
  const chats = useMemo(() => {
    const rank = (c: { pinnedAt?: number; archivedAt?: number }) => (c.archivedAt ? 2 : c.pinnedAt ? 0 : 1);
    return Object.values(conversations)
      .filter((c) => c.projectId === id && c.messages.length > 0 && (showArchived || !c.archivedAt))
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  }, [conversations, id, showArchived]);

  if (!project) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const pickSources = async () => {
    try {
      const { added: paths, failed } = await addSources(project.id);
      if (paths.length) setAdded((n) => n + 1);
      if (failed.length) Alert.alert(`Couldn't add ${failed.length === 1 ? 'a file' : 'some files'}`, failed.join('\n'));
    } catch (e) {
      Alert.alert('Could not add sources', e instanceof Error ? e.message : String(e));
    }
  };

  const listStyle = { paddingBottom: composerBase + LIST_GAP };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: project.name,
          headerRight: () => (
            <Pressable
              onPress={(e) => show(project, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
              hitSlop={10}
              accessibilityLabel="Project options"
            >
              <Feather name="more-vertical" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />

      {/* With KeyboardProvider mounted the window doesn't resize for the keyboard; this box pads
          for it, and the composer floats at its bottom as on the chat screen. The box runs to the
          bottom of the screen, so the keyboard's height is the padding it needs. The avoiding view
          measured its place on screen instead to allow for the header, and in release builds it
          came up short, leaving the composer partly under the keyboard. */}
      <Animated.View style={[styles.container, keyboardPad]}>
        <View style={styles.container}>
          <View style={styles.tabs} accessibilityRole="tablist">
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.key }}
                style={[styles.tab, tab === t.key && { backgroundColor: colors.surface }]}
              >
                <Text style={[styles.tabText, { color: tab === t.key ? colors.text : colors.textTertiary }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'chats' && (
            <FlatList
              data={chats}
              keyExtractor={(c) => c.id}
              contentContainerStyle={listStyle}
              renderItem={({ item }) => {
                const lastUser = item.messages.findLast((m) => m.role === 'user');
                const preview = lastUser ? messageText(lastUser).trim().split('\n')[0] : '';
                return (
                  <Pressable
                    onPress={() => openProjectChat(id, item.id, true)}
                    onLongPress={(e) => showChatMenu(item, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                    style={({ pressed }) => [styles.chat, pressed && { backgroundColor: colors.surfaceHover }]}
                  >
                    <View style={styles.chatHead}>
                      <Text numberOfLines={1} style={[styles.chatTitle, { color: colors.text }]}>
                        {item.title}
                      </Text>
                      {!!item.pinnedAt && <MaterialCommunityIcons name="pin" size={16} color={colors.textTertiary} />}
                      {!!item.archivedAt && <Feather name="archive" size={15} color={colors.textTertiary} />}
                    </View>
                    {!!preview && (
                      <Text numberOfLines={1} style={[styles.chatPreview, { color: colors.textSecondary }]}>
                        {preview}
                      </Text>
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Feather name="message-circle" size={28} color={colors.textTertiary} />
                  <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                    Chats you start in this project appear here. They share its workspace, sources and instructions.
                  </Text>
                </View>
              }
            />
          )}

          {tab === 'sources' && (
            <FileList
              workspace={workspace}
              under={SOURCES_DIR}
              refreshKey={added}
              contentContainerStyle={listStyle}
              empty="Add documents, spreadsheets, slides and other files for this project's chats to draw on."
              header={
                <Pressable
                  onPress={pickSources}
                  style={({ pressed }) => [styles.add, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                >
                  <View style={[styles.addIcon, { backgroundColor: colors.surface }]}>
                    <Feather name="plus" size={22} color={colors.text} />
                  </View>
                  <Text style={[styles.addText, { color: colors.text }]}>Add sources</Text>
                </Pressable>
              }
              footer={
                !tools ? (
                  <Text style={[styles.note, { color: colors.textTertiary }]}>
                    Chats read sources with the file tools. Turn on Files &amp; code in Settings so they can.
                  </Text>
                ) : undefined
              }
            />
          )}

          {tab === 'files' && (
            <FileList
              workspace={workspace}
              exclude={SOURCES_DIR}
              contentContainerStyle={listStyle}
              empty="Files you attach in this project's chats and files the models create appear here."
              allowClear
            />
          )}

          <ComposerDock
            draft={draft}
            onChangeDraft={setDraft}
            streaming={false}
            onSend={send}
            onStop={() => {}}
            usage={usage}
            progress={composerProgress}
            onBaseHeight={setComposerBase}
          />
        </View>
      </Animated.View>

      {menu}
      {chatMenu}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  tab: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  tabText: { fontSize: 16, fontWeight: '500' },
  chat: { paddingHorizontal: 20, paddingVertical: 12, gap: 2 },
  chatHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatTitle: { fontSize: 17, flexShrink: 1 },
  chatPreview: { fontSize: 15 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4, marginBottom: 16 },
  addIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 17 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 16, marginHorizontal: 12 },
});
