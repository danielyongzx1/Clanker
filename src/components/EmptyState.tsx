import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSuggestions } from '@/lib/suggestions';
import { useTheme } from '@/lib/theme';

const SUGGESTION_COLORS = ['#4C8DF6', '#EA4335', '#34A853', '#F4B400'];

type Props = {
  hasEndpoint: boolean;
  onSuggestion: (text: string) => void;
  onAddEndpoint: () => void;
  /** The chat about to be started is a temporary one, without memory. */
  memoryOff?: boolean;
  /** The name of the project the chat about to be started goes in. */
  project?: string;
};

export function EmptyState({ hasEndpoint, onSuggestion, onAddEndpoint, memoryOff, project }: Props) {
  const { colors } = useTheme();
  const { suggestions, loading, error, retry } = useSuggestions(project, memoryOff);

  if (!hasEndpoint) {
    return (
      <View style={styles.center}>
        <Text style={[styles.heading, { color: colors.text }]}>Connect a model to start</Text>
        <Pressable onPress={onAddEndpoint} style={[styles.cta, { backgroundColor: colors.sendBg }]}>
          <Text style={[styles.ctaText, { color: colors.sendFg }]}>Add an endpoint</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!!project && (
        <View style={styles.temporary}>
          <Feather name="folder" size={22} color={colors.textSecondary} />
          <Text numberOfLines={2} style={[styles.temporaryTitle, { color: colors.text }]}>
            {project}
          </Text>
          <Text style={[styles.temporaryText, { color: colors.textTertiary }]}>
            {memoryOff
              ? "A temporary chat in this project: it shares the project's files and instructions, but won't use or save memories."
              : "New chat in this project. It shares the project's files, sources and instructions."}
          </Text>
        </View>
      )}
      {memoryOff && !project && (
        <View style={styles.temporary}>
          <Feather name="eye-off" size={22} color={colors.textSecondary} />
          <Text style={[styles.temporaryTitle, { color: colors.text }]}>Temporary chat</Text>
          <Text style={[styles.temporaryText, { color: colors.textTertiary }]}>
            This chat won&apos;t use or save memories, and other chats can&apos;t look it up.
          </Text>
        </View>
      )}
      {loading && (
        <Text style={[styles.status, styles.loading, { color: colors.textTertiary }]}>Generating suggestions…</Text>
      )}
      {error && (
        <Pressable onPress={retry} accessibilityRole="button" style={styles.row}>
          <Feather name="refresh-cw" size={22} color={colors.textSecondary} />
          <Text style={[styles.status, { color: colors.textSecondary }]}>Suggestions unavailable. Tap to retry.</Text>
        </Pressable>
      )}
      {suggestions.map((s, index) => (
        <Pressable
          key={s.summary}
          onPress={() => onSuggestion(s.prompt)}
          accessibilityRole="button"
          accessibilityLabel={s.summary}
          accessibilityHint="Adds the full prompt to your message for editing"
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.5 }]}
        >
          <Feather name={s.icon} size={22} color={SUGGESTION_COLORS[index]} />
          <Text numberOfLines={1} style={[styles.rowText, { color: colors.text }]}>
            {s.summary}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 26, paddingBottom: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  heading: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
  cta: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  ctaText: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 14 },
  rowText: { fontSize: 17, flexShrink: 1 },
  status: { fontSize: 14, flexShrink: 1 },
  loading: { paddingVertical: 14 },
  temporary: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  temporaryTitle: { fontSize: 20, fontWeight: '600' },
  temporaryText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
