import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useProjectMenu } from '@/components/ProjectMenu';
import { useTheme } from '@/lib/theme';
import { useChatList } from '@/store/chats';
import { useProjects, type Project } from '@/store/projects';

function projectDate(ms: number) {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Every project, pinned ones first, then by latest activity. Long-press one for its menu. */
export default function ProjectsScreen() {
  const { colors } = useTheme();
  const projects = useProjects((s) => s.projects);
  const conversations = useChatList();
  const [query, setQuery] = useState('');
  const { show, menu } = useProjectMenu();

  const list = useMemo(() => {
    // A project's activity is its latest chat, or its own last edit.
    const active = new Map<string, number>();
    for (const c of Object.values(conversations)) {
      if (c.projectId && c.messages.length) active.set(c.projectId, Math.max(active.get(c.projectId) ?? 0, c.updatedAt));
    }
    const q = query.trim().toLowerCase();
    return Object.values(projects)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => ({ project: p, at: Math.max(p.updatedAt, active.get(p.id) ?? 0) }))
      .sort((a, b) => Number(!!b.project.pinnedAt) - Number(!!a.project.pinnedAt) || b.at - a.at);
  }, [projects, conversations, query]);

  const create = () => router.push('/projects/edit');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={create} hitSlop={10} accessibilityLabel="New project">
              <Feather name="plus" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={list}
        keyExtractor={(item) => item.project.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          Object.keys(projects).length > 0 ? (
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
          ) : undefined
        }
        renderItem={({ item: { project, at } }) => (
          <ProjectRow project={project} at={at} onLongPress={(x, y) => show(project, { x, y })} />
        )}
        ListEmptyComponent={
          query ? (
            <Text style={[styles.none, { color: colors.textTertiary }]}>No projects found</Text>
          ) : (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.surface }]}>
                <Feather name="folder" size={28} color={colors.text} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Keep related chats together</Text>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                Chats in a project share a workspace, sources you add, custom instructions and, if you like, a memory of
                their own.
              </Text>
              <Pressable onPress={create} style={[styles.cta, { backgroundColor: colors.sendBg }]}>
                <Text style={[styles.ctaText, { color: colors.sendFg }]}>New project</Text>
              </Pressable>
            </View>
          )
        }
      />
      {menu}
    </View>
  );
}

function ProjectRow({ project, at, onLongPress }: { project: Project; at: number; onLongPress: (x: number, y: number) => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/projects/[id]', params: { id: project.id } })}
      onLongPress={(e) => onLongPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surface }]}>
        <Feather name="folder" size={22} color={colors.text} />
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          {project.name}
        </Text>
        <Text style={[styles.date, { color: colors.textTertiary }]}>{projectDate(at)}</Text>
      </View>
      {!!project.pinnedAt && <MaterialCommunityIcons name="pin" size={20} color={colors.textTertiary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingVertical: 8, paddingBottom: 48 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 10 },
  icon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  date: { fontSize: 14 },
  none: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  empty: { alignItems: 'center', gap: 12, paddingTop: 96, paddingHorizontal: 40 },
  emptyIcon: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  cta: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 8 },
  ctaText: { fontSize: 15, fontWeight: '600' },
});
