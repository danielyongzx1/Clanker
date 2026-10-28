import Feather from '@expo/vector-icons/Feather';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PROVIDER_LABELS } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useSettings, type ThemePreference } from '@/store/settings';

function Section({ title, children, footer }: { title: string; children: ReactNode; footer?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>{children}</View>
      {footer && <Text style={[styles.footer, { color: colors.textTertiary }]}>{footer}</Text>}
    </View>
  );
}

const THEMES: { value: ThemePreference; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: 'system', label: 'System', icon: 'smartphone' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const BUDGETS = [8_000, 16_000, 32_000, 64_000, 128_000];

export default function SettingsScreen() {
  const { colors } = useTheme();
  const endpoints = useSettings((s) => s.endpoints);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const tools = useSettings((s) => s.tools);
  const setTools = useSettings((s) => s.setTools);
  const contextBudget = useSettings((s) => s.contextBudget);
  const setContextBudget = useSettings((s) => s.setContextBudget);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Section
        title="ENDPOINTS"
        footer="Connect any OpenAI-compatible, Anthropic, Ollama or Gemini API. Keys are stored in the device keychain."
      >
        {endpoints.map((e, i) => (
          <Pressable
            key={e.id}
            onPress={() => router.push({ pathname: '/settings/endpoint', params: { id: e.id } })}
            style={({ pressed }) => [
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
              pressed && { backgroundColor: colors.surfaceHover },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{e.name}</Text>
              <Text numberOfLines={1} style={[styles.rowDetail, { color: colors.textTertiary }]}>
                {PROVIDER_LABELS[e.type]} · {e.models.length} model{e.models.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textTertiary} />
          </Pressable>
        ))}
        <Pressable
          onPress={() => router.push('/settings/endpoint')}
          style={({ pressed }) => [
            styles.row,
            endpoints.length > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <Feather name="plus" size={18} color={colors.link} />
          <Text style={[styles.rowTitle, { color: colors.link }]}>Add endpoint</Text>
        </Pressable>
      </Section>

      <Section
        title="AGENT"
        footer={`Lets models read and write files of any type in a private workspace and run Python and JavaScript${
          Platform.OS === 'android' ? ' and shell commands' : ''
        } on this phone. Turn off for models that don't support tool calling.`}
      >
        <View style={styles.row}>
          <Feather name="tool" size={18} color={colors.textSecondary} />
          <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>File & code tools</Text>
          <Switch value={tools} onValueChange={setTools} />
        </View>
        <Pressable
          onPress={() => router.push('/settings/workspace')}
          style={({ pressed }) => [
            styles.row,
            { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            pressed && { backgroundColor: colors.surfaceHover },
          ]}
        >
          <Feather name="folder" size={18} color={colors.textSecondary} />
          <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>Workspace files</Text>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </Pressable>
      </Section>

      <Section
        title="CONTEXT BUDGET"
        footer="How much chat history to keep for local and other servers that don't report a model's context size; set it to what your server is configured for. Models summarise older history to stay under it, and the app compresses it automatically past 90%."
      >
        <View style={styles.segment}>
          {BUDGETS.map((b) => {
            const selected = contextBudget === b;
            return (
              <Pressable
                key={b}
                onPress={() => setContextBudget(b)}
                style={[styles.segmentItem, selected && { backgroundColor: colors.background }]}
              >
                <Text style={{ color: selected ? colors.text : colors.textSecondary, fontWeight: selected ? '600' : '400' }}>
                  {b / 1000}K
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="APPEARANCE">
        <View style={styles.segment}>
          {THEMES.map((t) => {
            const selected = theme === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => setTheme(t.value)}
                style={[styles.segmentItem, selected && { backgroundColor: colors.background }]}
              >
                <Feather name={t.icon} size={16} color={selected ? colors.text : colors.textSecondary} />
                <Text style={{ color: selected ? colors.text : colors.textSecondary, fontWeight: selected ? '600' : '400' }}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Text style={[styles.version, { color: colors.textTertiary }]}>
        Clanker {Constants.expoConfig?.version ?? ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '500', marginBottom: 8, marginLeft: 12 },
  card: { borderRadius: 14, overflow: 'hidden' },
  footer: { fontSize: 13, lineHeight: 18, marginTop: 8, marginHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowTitle: { fontSize: 16 },
  rowDetail: { fontSize: 13, marginTop: 2 },
  segment: { flexDirection: 'row', padding: 4, gap: 4 },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  version: { textAlign: 'center', fontSize: 13 },
});
