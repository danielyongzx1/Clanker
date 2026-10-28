import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

const SUGGESTIONS: { icon: ComponentProps<typeof Feather>['name']; tint: string; text: string }[] = [
  { icon: 'cpu', tint: '#4C8DF6', text: 'Explain how transformers work, simply' },
  { icon: 'mail', tint: '#EA4335', text: 'Write a polite follow-up email' },
  { icon: 'map-pin', tint: '#34A853', text: 'Plan a 3-day trip to Kyoto' },
  { icon: 'code', tint: '#F4B400', text: 'Debug a React useEffect loop' },
];

type Props = {
  hasEndpoint: boolean;
  onSuggestion: (text: string) => void;
  onAddEndpoint: () => void;
};

export function EmptyState({ hasEndpoint, onSuggestion, onAddEndpoint }: Props) {
  const { colors } = useTheme();

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
      {SUGGESTIONS.map((s) => (
        <Pressable
          key={s.text}
          onPress={() => onSuggestion(s.text)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.5 }]}
        >
          <Feather name={s.icon} size={22} color={s.tint} />
          <Text numberOfLines={1} style={[styles.rowText, { color: colors.text }]}>
            {s.text}
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
});
