import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';
import { ActionSheetIOS, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { openWorkspaceFile, shareWorkspaceFile } from '@/lib/openFile';
import { useTheme } from '@/lib/theme';
import { formatSize, type Workspace, type WorkspaceEntry } from '@/lib/workspace';
import { FileIcon } from './FileIcon';

function report(e: unknown) {
  Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
}

/**
 * The files in a workspace, newest first: tap to open, long-press (or the dots) to share or delete.
 * `under` limits the list to one folder and names files relative to it; `exclude` leaves one out.
 */
export function FileList({
  workspace,
  under,
  exclude,
  empty,
  header,
  footer,
  allowClear,
  refreshKey,
  contentContainerStyle,
}: {
  workspace: Workspace;
  under?: string;
  exclude?: string;
  /** Shown when there are no files. */
  empty: string;
  header?: ReactElement;
  footer?: ReactElement;
  /** Offers to delete every listed file. */
  allowClear?: boolean;
  /** Change it to list the files again (after adding some, say). */
  refreshKey?: unknown;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);

  const refresh = useCallback(() => {
    try {
      const all = workspace.walk(under ?? '');
      const listed = exclude ? all.filter((e) => e.path !== exclude && !e.path.startsWith(`${exclude}/`)) : all;
      setEntries(listed.sort((a, b) => b.modified - a.modified));
    } catch (e) {
      report(e);
    }
    // refreshKey isn't read, but a new one makes a new callback, which useFocusEffect runs again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, under, exclude, refreshKey]);
  useFocusEffect(refresh);

  const label = (path: string) => (under && path.startsWith(`${under}/`) ? path.slice(under.length + 1) : path);

  const remove = (path: string) =>
    Alert.alert('Delete file?', label(path), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          try {
            workspace.fileAt(path).delete();
          } catch (e) {
            report(e);
          }
          refresh();
        },
      },
    ]);

  const actions = (path: string) => {
    const share = () => shareWorkspaceFile(workspace, path).catch(report);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: label(path), options: ['Share…', 'Delete', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
        (i) => (i === 0 ? share() : i === 1 ? remove(path) : undefined)
      );
    } else {
      Alert.alert(label(path), undefined, [
        { text: 'Delete', style: 'destructive', onPress: () => remove(path) },
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share…', onPress: share },
      ]);
    }
  };

  const clearAll = () =>
    Alert.alert('Delete all these files?', 'Chats keep their history, but the agent loses these files.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: () => {
          try {
            for (const e of entries) workspace.fileAt(e.path).delete();
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
      contentContainerStyle={[styles.content, contentContainerStyle]}
      data={entries}
      keyExtractor={(e) => e.path}
      ListHeaderComponent={
        <>
          {header}
          {entries.length > 0 && (
            <Text style={[styles.summary, { color: colors.textTertiary }]}>
              {entries.length} file{entries.length === 1 ? '' : 's'} · {formatSize(total)}
            </Text>
          )}
        </>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Feather name="folder" size={28} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>{empty}</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const name = label(item.path);
        const folder = name.includes('/') ? `${name.slice(0, name.lastIndexOf('/'))}/ · ` : '';
        return (
          <Pressable
            onPress={() => openWorkspaceFile(workspace, item.path).catch(report)}
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
            <FileIcon name={item.path} uri={workspace.fileAt(item.path).uri} size={36} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                {name.split('/').pop()}
              </Text>
              <Text numberOfLines={1} style={[styles.detail, { color: colors.textTertiary }]}>
                {folder}
                {formatSize(item.size)}
              </Text>
            </View>
            <Pressable onPress={() => actions(item.path)} hitSlop={10} accessibilityLabel="More actions">
              <Feather name="more-vertical" size={18} color={colors.textTertiary} />
            </Pressable>
          </Pressable>
        );
      }}
      ListFooterComponent={
        <>
          {allowClear && entries.length > 0 && (
            <Pressable onPress={clearAll} style={styles.clear} hitSlop={6}>
              <Text style={{ color: colors.danger, fontSize: 16 }}>Delete all files</Text>
            </Pressable>
          )}
          {footer}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  summary: { fontSize: 13, marginBottom: 8, marginLeft: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  first: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  last: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  name: { fontSize: 16 },
  detail: { fontSize: 13, marginTop: 2 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  clear: { alignSelf: 'center', marginTop: 24, padding: 8 },
});
