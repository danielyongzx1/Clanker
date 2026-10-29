import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Row, Section, ToggleRow } from '@/components/Form';
import { SegmentedControl } from '@/components/SegmentedControl';
import { PROVIDER_LABELS } from '@/lib/providers';
import { shellAvailable } from '@/lib/tools';
import { entryOn, LOCAL_TOOL_GROUPS, WEB_TOOLS } from '@/lib/tools/catalog';
import { useTheme } from '@/lib/theme';
import { SEARCH_PROVIDERS } from '@/lib/tools/web';
import { useSettings, type ThemePreference } from '@/store/settings';

const THEMES: { value: ThemePreference; label: string; icon: 'smartphone' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'System', icon: 'smartphone' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/** How many of the listed tools are on, out of those this device has. */
function countOn(disabled: string[]) {
  const entries = LOCAL_TOOL_GROUPS.flatMap((g) => g.tools).filter((e) => shellAvailable() || !e.names.includes('run_shell'));
  return { on: entries.filter((e) => entryOn(e, disabled)).length, total: entries.length };
}

function webDetail(provider: string, disabled: string[]) {
  const [search, fetch] = WEB_TOOLS.map((e) => entryOn(e, disabled));
  if (search && fetch) return `Search with ${provider} and read pages`;
  if (search) return `Search with ${provider}`;
  return fetch ? 'Read web pages' : 'Every web tool is turned off';
}

export default function SettingsScreen() {
  const { colors } = useTheme();
  const endpoints = useSettings((s) => s.endpoints);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const tools = useSettings((s) => s.tools);
  const setTools = useSettings((s) => s.setTools);
  const disabledTools = useSettings((s) => s.disabledTools);
  const web = useSettings((s) => s.web);
  const setWeb = useSettings((s) => s.setWeb);
  const searchProvider = useSettings((s) => s.search.provider);
  const contextUsage = useSettings((s) => s.contextUsage);
  const setContextUsage = useSettings((s) => s.setContextUsage);
  const compression = useSettings((s) => s.compression);

  const { on, total } = countOn(disabledTools);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Section title="Models" footer="Connect any OpenAI-compatible, Anthropic, Ollama or Gemini API. Keys stay in the device keychain.">
        {endpoints.map((e) => (
          <Row
            key={e.id}
            icon="server"
            title={e.name}
            detail={`${PROVIDER_LABELS[e.type]} · ${e.models.length} model${e.models.length === 1 ? '' : 's'}`}
            onPress={() => router.push({ pathname: '/settings/endpoint', params: { id: e.id } })}
          />
        ))}
        <Row icon="plus" title="Add endpoint" tint="link" onPress={() => router.push('/settings/endpoint')} />
      </Section>

      <Section title="Agent" footer="Turn these off for models that don't support tool calling.">
        <ToggleRow
          icon="tool"
          title="Files & code"
          detail={
            on === total
              ? `Work with files and run Python${Platform.OS === 'android' ? ', JavaScript and shell commands' : ' and JavaScript'} on this phone`
              : `${on} of ${total} tools on`
          }
          value={tools}
          onValueChange={setTools}
          onPress={() => router.push('/settings/tools')}
        />
        <ToggleRow
          icon="globe"
          title="Web access"
          detail={tools ? webDetail(SEARCH_PROVIDERS[searchProvider].label, disabledTools) : 'Needs files & code'}
          value={web && tools}
          onValueChange={setWeb}
          onPress={() => router.push('/settings/search')}
          disabled={!tools}
        />
        <Row icon="folder" title="Workspace files" onPress={() => router.push('/settings/workspace')} />
      </Section>

      <Section title="Chats">
        <ToggleRow
          icon="bar-chart-2"
          title="Context meter"
          detail="Show how much of the model's context a chat uses while you type"
          value={contextUsage}
          onValueChange={setContextUsage}
        />
        <Row
          icon="minimize-2"
          title="Auto-compression"
          value={`${compression.trigger}% → ${compression.target}%`}
          onPress={() => router.push('/settings/context')}
        />
      </Section>

      <Section title="Appearance">
        <View style={styles.segment}>
          <SegmentedControl options={THEMES} value={theme} onChange={setTheme} />
        </View>
      </Section>

      <Text style={[styles.version, { color: colors.textTertiary }]}>Clanker {Constants.expoConfig?.version ?? ''}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  segment: { padding: 12 },
  version: { textAlign: 'center', fontSize: 13, marginTop: 4 },
});
