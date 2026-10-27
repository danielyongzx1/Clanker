import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

const SUGGESTIONS = [
  { title: 'Explain', detail: 'how transformers work, simply' },
  { title: 'Write', detail: 'a polite follow-up email' },
  { title: 'Plan', detail: 'a 3-day trip to Kyoto' },
  { title: 'Debug', detail: 'a React useEffect loop' },
];

type Props = {
  hasEndpoint: boolean;
  onSuggestion: (text: string) => void;
  onAddEndpoint: () => void;
};

export function EmptyState({ hasEndpoint, onSuggestion, onAddEndpoint }: Props) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Text style={[styles.heading, { color: colors.text }]}>
          {hasEndpoint ? 'What can I help with?' : 'Connect a model to start'}
        </Text>
        {!hasEndpoint && (
          <Pressable onPress={onAddEndpoint} style={[styles.cta, { backgroundColor: colors.sendBg }]}>
            <Text style={[styles.ctaText, { color: colors.sendFg }]}>Add an endpoint</Text>
          </Pressable>
        )}
      </View>
      {hasEndpoint && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.suggestions}
        >
          {SUGGESTIONS.map((s) => (
            <Pressable
              key={s.title}
              onPress={() => onSuggestion(`${s.title} ${s.detail}`)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: colors.border, backgroundColor: pressed ? colors.surface : colors.background },
              ]}
            >
              <Text style={[styles.chipTitle, { color: colors.text }]}>{s.title}</Text>
              <Text style={[styles.chipDetail, { color: colors.textTertiary }]}>{s.detail}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  heading: { fontSize: 24, fontWeight: '600', textAlign: 'center' },
  cta: { borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  ctaText: { fontSize: 15, fontWeight: '600' },
  suggestions: { paddingHorizontal: 12, gap: 8, paddingBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: 220 },
  chipTitle: { fontSize: 15, fontWeight: '600' },
  chipDetail: { fontSize: 14, marginTop: 1 },
});
