import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { messageText, useChats, type Conversation } from '@/store/chats';
import { useProjects, type Project } from '@/store/projects';
import { useSettings } from '@/store/settings';
import { useUI } from '@/store/ui';
import { useChatMenu } from './ChatMenu';
import { openProjectChat, useProjectMenu } from './ProjectMenu';

const DAY = 24 * 60 * 60 * 1000;

type Item = { kind: 'project'; project: Project } | { kind: 'chat'; chat: Conversation };
type Section = { title: string; data: Item[] };

const chatItem = (chat: Conversation): Item => ({ kind: 'chat', chat });

function groupByDate(conversations: Conversation[]): Section[] {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const buckets: { title: string; after: number }[] = [
    { title: 'Today', after: startOfToday },
    { title: 'Yesterday', after: startOfToday - DAY },
    { title: 'Previous 7 days', after: startOfToday - 7 * DAY },
    { title: 'Previous 30 days', after: startOfToday - 30 * DAY },
    { title: 'Older', after: -Infinity },
  ];
  const sections = buckets.map((b) => ({ title: b.title, data: [] as Item[] }));
  for (const c of conversations) {
    sections[buckets.findIndex((b) => c.updatedAt >= b.after)].data.push(chatItem(c));
  }
  return sections.filter((s) => s.data.length);
}

export function Sidebar({ navigation }: DrawerContentComponentProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const conversations = useChats((s) => s.conversations);
  const currentId = useUI((s) => s.currentId);
  const open = useUI((s) => s.open);
  const projects = useProjects((s) => s.projects);
  const showArchived = useSettings((s) => s.showArchived);
  const { show: showProjectMenu, menu: projectMenu } = useProjectMenu({
    onNewChat: () => navigation.closeDrawer(),
    onNavigate: () => navigation.closeDrawer(),
  });
  const { show: showChatMenu, menu: chatMenu } = useChatMenu();
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: Conversation) =>
      !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => messageText(m).toLowerCase().includes(q));
    const chats = Object.values(conversations)
      .filter((c) => c.messages.length > 0 && (showArchived || !c.archivedAt) && matches(c))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    // Pinned projects and chats come first, in the order they were pinned, wherever the chats live.
    const pinned: { at: number; item: Item }[] = [
      ...Object.values(projects)
        .filter((p) => p.pinnedAt && (!q || p.name.toLowerCase().includes(q)))
        .map((p) => ({ at: p.pinnedAt!, item: { kind: 'project' as const, project: p } })),
      ...chats.filter((c) => c.pinnedAt && !c.archivedAt).map((c) => ({ at: c.pinnedAt!, item: chatItem(c) })),
    ].sort((a, b) => a.at - b.at);

    // Chats in a project are listed in it, and here only when pinned or searched for.
    const listed = (c: Conversation) => !c.pinnedAt && (!c.projectId || q);
    return [
      ...(pinned.length ? [{ title: 'Pinned', data: pinned.map((p) => p.item) }] : []),
      ...groupByDate(chats.filter((c) => !c.archivedAt && listed(c))),
      ...(showArchived
        ? [{ title: 'Archived', data: chats.filter((c) => c.archivedAt && (!c.projectId || q)).map(chatItem) }]
        : []
      ).filter((s) => s.data.length),
    ];
  }, [conversations, projects, query, showArchived]);

  const select = (id: string | null) => {
    navigation.closeDrawer();
    // A project's chats open over its page, with a back button to it.
    const projectId = id ? conversations[id]?.projectId : undefined;
    if (id && projectId) openProjectChat(projectId, id);
    else open(id);
  };

  const goTo = (href: '/projects' | { pathname: '/projects/[id]'; params: { id: string } }) => {
    navigation.closeDrawer();
    router.push(href);
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
        style={({ pressed }) => [styles.item, styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Feather name="message-circle" size={18} color={colors.text} />
        <Text style={[styles.itemText, { color: colors.text, fontWeight: '500' }]}>New chat</Text>
      </Pressable>
      <Pressable
        onPress={() => goTo('/projects')}
        style={({ pressed }) => [styles.item, styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
      >
        <Feather name="folder" size={18} color={colors.text} />
        <Text style={[styles.itemText, { color: colors.text, fontWeight: '500' }]}>Projects</Text>
      </Pressable>

      <SectionList
        sections={sections}
        keyExtractor={(item) => (item.kind === 'project' ? `p:${item.project.id}` : item.chat.id)}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 12 }}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: colors.textTertiary }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          if (item.kind === 'project') {
            const p = item.project;
            return (
              <Pressable
                onPress={() => goTo({ pathname: '/projects/[id]', params: { id: p.id } })}
                onLongPress={(e) => showProjectMenu(p, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                style={({ pressed }) => [styles.item, styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
              >
                <Feather name="folder" size={18} color={colors.textSecondary} />
                <Text numberOfLines={1} style={[styles.itemText, styles.grow, { color: colors.text }]}>
                  {p.name}
                </Text>
              </Pressable>
            );
          }
          const c = item.chat;
          const project = c.projectId ? projects[c.projectId] : undefined;
          return (
            <Pressable
              onPress={() => select(c.id)}
              onLongPress={(e) => showChatMenu(c, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
              style={({ pressed }) => [
                styles.item,
                (c.id === currentId || pressed) && { backgroundColor: colors.surfaceHover },
              ]}
            >
              <Text numberOfLines={1} style={[styles.itemText, { color: colors.text }]}>
                {c.title}
              </Text>
              {project && (
                <Text numberOfLines={1} style={[styles.itemProject, { color: colors.textTertiary }]}>
                  {project.name}
                </Text>
              )}
            </Pressable>
          );
        }}
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

      {projectMenu}
      {chatMenu}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 9 },
  newChatIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { fontSize: 13, fontWeight: '600', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  item: { marginHorizontal: 8, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10 },
  itemText: { fontSize: 16 },
  itemProject: { fontSize: 13, marginTop: 2 },
  grow: { flex: 1 },
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
});
