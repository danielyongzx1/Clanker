import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { openWorkspaceFile, shareWorkspaceFile } from '@/lib/openFile';
import type { ContentPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useWorkspace } from '@/lib/useWorkspace';
import { formatSize, type Workspace } from '@/lib/workspace';
import { FileIcon } from './FileIcon';

// A script or shell command can touch many files; past this many the rest wait behind a toggle.
const SHOWN = 4;

/** Every workspace file a reply's tool calls created or changed, in the order first touched. */
export function filesOf(content: ContentPart[]) {
  const seen = new Set<string>();
  for (const part of content) if (part.type === 'tool') for (const path of part.files ?? []) seen.add(path);
  return [...seen];
}

function uriOf(ws: Workspace | null, path: string) {
  try {
    return ws?.fileAt(path).uri;
  } catch {
    return undefined;
  }
}

function detail(ws: Workspace | null, path: string) {
  const name = path.split('/').pop() ?? path;
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'File';
  const folder = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/ · ` : '';
  let size = '';
  try {
    const file = ws?.fileAt(path);
    if (file?.exists) size = ` · ${formatSize(file.size)}`;
  } catch {
    // Unreadable stats only cost the size.
  }
  return `${folder}${ext}${size}`;
}

/** Cards for the files a reply produced, under its answer: tap to open, long-press to share. */
export function TurnFiles({ files }: { files: string[] }) {
  const { colors } = useTheme();
  const ws = useWorkspace();
  const [all, setAll] = useState(false);
  // Files the reply deleted or moved away again aren't worth a card.
  const present = files.filter((p) => {
    try {
      return !ws || ws.fileAt(p).exists;
    } catch {
      return false;
    }
  });
  if (!present.length) return null;
  const shown = all ? present : present.slice(0, SHOWN);

  const run = (fn: (ws: Workspace, p: string) => Promise<void>, path: string) =>
    (ws ? fn(ws, path) : Promise.reject(new Error('This chat has no workspace.'))).catch((e) =>
      Alert.alert('Could not open file', e instanceof Error ? e.message : String(e))
    );

  return (
    <View style={styles.list}>
      {shown.map((path) => {
        const name = path.split('/').pop() ?? path;
        return (
          <Pressable
            key={path}
            onPress={() => run(openWorkspaceFile, path)}
            onLongPress={() => run(shareWorkspaceFile, path)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}`}
            accessibilityHint="Long-press to share"
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { backgroundColor: colors.surfaceHover },
            ]}
          >
            <FileIcon name={name} uri={uriOf(ws, path)} size={44} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                {name}
              </Text>
              <Text numberOfLines={1} style={[styles.detail, { color: colors.textSecondary }]}>
                {detail(ws, path)}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {present.length > SHOWN && (
        <Pressable onPress={() => setAll(!all)} hitSlop={6} style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}>
          <Text style={[styles.moreText, { color: colors.textSecondary }]}>
            {all ? 'Show fewer' : `Show ${present.length - SHOWN} more file${present.length - SHOWN === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, marginTop: 8, marginBottom: 4 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 13 },
  more: { alignSelf: 'flex-start', paddingVertical: 4, marginLeft: 2 },
  moreText: { fontSize: 14, fontWeight: '500' },
});
