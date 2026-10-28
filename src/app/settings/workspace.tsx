import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { openWorkspaceFile, shareWorkspaceFile } from '@/lib/openFile';
import { useTheme } from '@/lib/theme';
import { ensureWorkspace, fileAt, formatSize, walk, workspaceDir, type WorkspaceEntry } from '@/lib/workspace';

function report(e: unknown) {
  Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
}

/** Everything the agent can see: files the user attached and files the models wrote. */
export default function WorkspaceScreen() {
  const { colors } = useTheme();
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);

  const refresh = useCallback(() => {
    try {
      setEntries(walk().sort((a, b) => b.modified - a.modified));
    } catch (e) {
      report(e);
    }
  }, []);
  useFocusEffect(refresh);

  const remove = (path: string) =>
    Alert.alert('Delete file?', path, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            fileAt(path).delete();
          } catch (e) {
            report(e);
          }
          refresh();
        },
      },
    ]);

  const actions = (path: string) => {
    const share = () => shareWorkspaceFile(path).catch(report);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: path, options: ['Share…', 'Delete', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (i) => (i === 0 ? share() : i === 1 ? remove(path) : undefined)
      );
    } else {
      Alert.alert(path, undefined, [
        { text: 'Delete', style: 'destructive', onPress: () => remove(path) },
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share…', onPress: share },
      ]);
    }
  };

  const clearAll = () =>
    Alert.alert('Delete all workspace files?', 'Chats keep their history, but the agent loses these files.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: () => {
          try {
            if (workspaceDir.exists) workspaceDir.delete();
            ensureWorkspace();
          } catch (e) {
            report(e);
          }
          refresh();
        },
      },
    ]);

  const total = entries.reduce((n, e) => n + e.size, 0);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      data={entries}
      keyExtractor={(e) => e.path}
      ListHeaderComponent={
        <Text style={[styles.summary, { color: colors.textTertiary }]}>
          {entries.length} file{entries.length === 1 ? '' : 's'} · {formatSize(total)}
        </Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Feather name="folder" size={28} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            Files you attach in chats and files the models create appear here.
          </Text>
        </View>
      }
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => openWorkspaceFile(item.path).catch(report)}
          onLongPress={() => actions(item.path)}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: colors.surface },
            index === 0 && styles.first,
            index === entries.length - 1 && styles.last,
            index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <Feather name="file" size={18} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
              {item.path.split('/').pop()}
            </Text>
            <Text numberOfLines={1} style={[styles.detail, { color: colors.textTertiary }]}>
              {item.path.includes('/') ? `${item.path.slice(0, item.path.lastIndexOf('/'))}/ · ` : ''}
              {formatSize(item.size)}
            </Text>
          </View>
          <Pressable onPress={() => actions(item.path)} hitSlop={10} accessibilityLabel="More actions">
            <Feather name="more-horizontal" size={18} color={colors.textTertiary} />
          </Pressable>
        </Pressable>
      )}
      ListFooterComponent={
        entries.length ? (
          <Pressable onPress={clearAll} style={styles.clear} hitSlop={6}>
            <Text style={{ color: colors.danger, fontSize: 16 }}>Delete all files</Text>
          </Pressable>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  summary: { fontSize: 13, marginBottom: 8, marginLeft: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  first: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  last: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  name: { fontSize: 16 },
  detail: { fontSize: 13, marginTop: 2 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  clear: { alignSelf: 'center', marginTop: 24, padding: 8 },
});
