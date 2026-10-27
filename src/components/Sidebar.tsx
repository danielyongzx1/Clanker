import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { stopStreaming } from '@/lib/chat';
import { useTheme } from '@/lib/theme';
import { messageText, useChats, type Conversation } from '@/store/chats';
import { useUI } from '@/store/ui';

const DAY = 24 * 60 * 60 * 1000;

function groupByDate(conversations: Conversation[]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const buckets: { title: string; after: number }[] = [
    { title: 'Today', after: startOfToday },
    { title: 'Yesterday', after: startOfToday - DAY },
    { title: 'Previous 7 days', after: startOfToday - 7 * DAY },
    { title: 'Previous 30 days', after: startOfToday - 30 * DAY },
    { title: 'Older', after: -Infinity },
  ];
  const sections = buckets.map((b) => ({ title: b.title, data: [] as Conversation[] }));
  for (const c of conversations) {
    sections[buckets.findIndex((b) => c.updatedAt >= b.after)].data.push(c);
  }
  return sections.filter((s) => s.data.length);
}

export function Sidebar({ navigation }: DrawerContentComponentProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const conversations = useChats((s) => s.conversations);
  const currentId = useUI((s) => s.currentId);
  const open = useUI((s) => s.open);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [renameText, setRenameText] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = Object.values(conversations)
      .filter((c) => c.messages.length > 0)
      .filter(
        (c) =>
          !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => messageText(m).toLowerCase().includes(q))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return groupByDate(list);
  }, [conversations, query]);

  const select = (id: string | null) => {
    open(id);
    navigation.closeDrawer();
  };

  const showActions = (c: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(c.title, undefined, [
      {
        text: 'Rename',
        onPress: () => {
          setRenameText(c.title);
          setRenaming(c);
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          stopStreaming(c.id);
          useChats.getState().remove(c.id);
          if (currentId === c.id) open(null);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const saveRename = () => {
    if (renaming && renameText.trim()) useChats.getState().rename(renaming.id, renameText.trim());
    setRenaming(null);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.sidebar, paddingTop: insets.top + 8 }]}>
      <View style={styles.top}>
        <View style={[styles.search, { backgroundColor: colors.surface }]}>
          <Feather name="search" size={16} color={colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textTertiary}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
        <Pressable onPress={() => select(null)} hitSlop={8} style={styles.newChatIcon} accessibilityLabel="New chat">
          <Feather name="edit" size={20} color={colors.text} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => select(null)}
        style={({ pressed }) => [styles.item, styles.newChat, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Feather name="message-circle" size={18} color={colors.text} />
        <Text style={[styles.itemText, { color: colors.text, fontWeight: '500' }]}>New chat</Text>
      </Pressable>

      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: colors.textTertiary }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => select(item.id)}
            onLongPress={() => showActions(item)}
            style={({ pressed }) => [
              styles.item,
              (item.id === currentId || pressed) && { backgroundColor: colors.surfaceHover },
            ]}
          >
            <Text numberOfLines={1} style={[styles.itemText, { color: colors.text }]}>
              {item.title}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textTertiary }]}>
            {query ? 'No chats found' : 'Your chats will appear here'}
          </Text>
        }
      />

      <Pressable
        onPress={() => {
          navigation.closeDrawer();
          router.push('/settings');
        }}
        style={({ pressed }) => [
          styles.footer,
          { borderTopColor: colors.border, paddingBottom: insets.bottom + 12 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.surfaceHover }]}>
          <Feather name="settings" size={16} color={colors.text} />
        </View>
        <Text style={[styles.itemText, { color: colors.text, fontWeight: '500' }]}>Settings</Text>
      </Pressable>

      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <Pressable style={[styles.dialogBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setRenaming(null)}>
          <Pressable style={[styles.dialog, { backgroundColor: colors.background }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>Rename chat</Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={saveRename}
              style={[styles.dialogInput, { color: colors.text, borderColor: colors.border }]}
            />
            <View style={styles.dialogButtons}>
              <Pressable onPress={() => setRenaming(null)} style={styles.dialogButton}>
                <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveRename} style={[styles.dialogButton, { backgroundColor: colors.sendBg }]}>
                <Text style={{ color: colors.sendFg, fontSize: 16, fontWeight: '600' }}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 9 },
  newChatIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  newChat: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { fontSize: 13, fontWeight: '600', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  item: { marginHorizontal: 8, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10 },
  itemText: { fontSize: 16 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dialogBackdrop: { flex: 1, justifyContent: 'center', padding: 32 },
  dialog: { borderRadius: 20, padding: 20, gap: 16 },
  dialogTitle: { fontSize: 18, fontWeight: '600' },
  dialogInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dialogButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
});
