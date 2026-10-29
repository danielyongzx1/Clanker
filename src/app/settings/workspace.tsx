import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Row, Section } from '@/components/Form';
import { workspaceLabel } from '@/lib/projects';
import { useTheme } from '@/lib/theme';
import { allWorkspaces, formatSize, type Workspace } from '@/lib/workspace';

type Summary = { ws: Workspace; label: string; files: number; size: number };

const KINDS: { kind: string; title: string; icon: 'folder' | 'message-circle' | 'clock' }[] = [
  { kind: 'project', title: 'Projects', icon: 'folder' },
  { kind: 'chat', title: 'Chats', icon: 'message-circle' },
  { kind: 'shared', title: 'Before per-chat workspaces', icon: 'clock' },
];

/** Every workspace on the device: one per project, one per chat that has files, and the old shared one. */
export default function WorkspacesScreen() {
  const { colors } = useTheme();
  const [summaries, setSummaries] = useState<Summary[]>([]);

  const refresh = useCallback(() => {
    try {
      const found = allWorkspaces().map((ws) => {
        const entries = ws.walk();
        return { ws, label: workspaceLabel(ws), files: entries.length, size: entries.reduce((n, e) => n + e.size, 0) };
      });
      // A project's workspace shows even when empty; a chat's only once it holds something.
      setSummaries(found.filter((s) => s.files || s.ws.key.startsWith('project:')).sort((a, b) => b.size - a.size));
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    }
  }, []);
  useFocusEffect(refresh);

  const total = summaries.reduce((n, s) => n + s.size, 0);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: colors.textTertiary }]}>
        Each chat has its own workspace for the files you attach and the files models create. Chats in a project share
        the project&apos;s. {summaries.length ? `${formatSize(total)} in all.` : ''}
      </Text>
      {KINDS.map(({ kind, title, icon }) => {
        const rows = summaries.filter((s) => s.ws.key.split(':')[0] === kind);
        return rows.length ? (
          <Section key={kind} title={title}>
            {rows.map((s) => (
              <Row
                key={s.ws.key}
                icon={icon}
                title={s.label}
                detail={s.files ? `${s.files} file${s.files === 1 ? '' : 's'} · ${formatSize(s.size)}` : 'Empty'}
                onPress={() => router.push({ pathname: '/settings/files', params: { key: s.ws.key } })}
              />
            ))}
          </Section>
        ) : null;
      })}
      {!summaries.length && (
        <View style={styles.empty}>
          <Feather name="folder" size={28} color={colors.textTertiary} />
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            Files you attach in chats and files the models create appear here.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginBottom: 24 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
