import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Row, Section, ToggleRow } from '@/components/Form';
import { SegmentedControl } from '@/components/SegmentedControl';
import { UpdateRow } from '@/components/Updates';
import { PROVIDER_LABELS } from '@/lib/providers';
import { entryAvailable } from '@/lib/tools';
import { entryOn, LOCAL_TOOL_GROUPS, WEB_TOOLS } from '@/lib/tools/catalog';
import { useTheme } from '@/lib/theme';
import { SEARCH_PROVIDERS } from '@/lib/tools/web';
import { updatesSupported } from '@/lib/updates';
import { useMemory } from '@/store/memory';
import { useSettings, type FollowUpMode, type ThemePreference } from '@/store/settings';
import { useUpdates } from '@/store/updates';

const THEMES: { value: ThemePreference; label: string; icon: 'smartphone' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'System', icon: 'smartphone' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const FOLLOW_UPS: { value: FollowUpMode; label: string; icon: 'list' | 'corner-down-right' }[] = [
  { value: 'queue', label: 'Queue', icon: 'list' },
  { value: 'steer', label: 'Steer', icon: 'corner-down-right' },
];

/** How many of the listed tools are on, out of those this device has. */
function countOn(disabled: string[]) {
  const entries = LOCAL_TOOL_GROUPS.flatMap((g) => g.tools).filter(entryAvailable);
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
  const decodeSpeed = useSettings((s) => s.decodeSpeed);
  const setDecodeSpeed = useSettings((s) => s.setDecodeSpeed);
  const cacheHits = useSettings((s) => s.cacheHits);
  const setCacheHits = useSettings((s) => s.setCacheHits);
  const compression = useSettings((s) => s.compression);
  const memory = useSettings((s) => s.memory);
  const setMemory = useSettings((s) => s.setMemory);
  const showArchived = useSettings((s) => s.showArchived);
  const setShowArchived = useSettings((s) => s.setShowArchived);
  const titleGeneration = useSettings((s) => s.titleGeneration);
  const setTitleGeneration = useSettings((s) => s.setTitleGeneration);
  const followUp = useSettings((s) => s.followUp);
  const setFollowUp = useSettings((s) => s.setFollowUp);
  const memoryCount = useMemory((s) => s.memories.filter((m) => !m.projectId).length);
  const checkOnLaunch = useUpdates((s) => s.checkOnLaunch);
  const setCheckOnLaunch = useUpdates((s) => s.setCheckOnLaunch);
  const prereleases = useUpdates((s) => s.prereleases);
  const setPrereleases = useUpdates((s) => s.setPrereleases);

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
          icon="bookmark"
          title="Memory"
          detail={memoryCount ? `${memoryCount} saved memor${memoryCount === 1 ? 'y' : 'ies'}` : 'Remember things about you across chats'}
          value={memory}
          onValueChange={setMemory}
          onPress={() => router.push('/settings/memory')}
        />
        <ToggleRow
          icon="type"
          title="Generate titles"
          detail="Ask the model to name each chat after its first reply"
          value={titleGeneration}
          onValueChange={setTitleGeneration}
        />
        <ToggleRow
          icon="archive"
          title="Show archived chats"
          detail="List archived chats in the sidebar and in projects"
          value={showArchived}
          onValueChange={setShowArchived}
        />
        <ToggleRow
          icon="bar-chart-2"
          title="Context meter"
          detail="Show how much of the model's context a chat uses while you type"
          value={contextUsage}
          onValueChange={setContextUsage}
        />
        <ToggleRow
          icon="zap"
          title="Decode speed"
          detail="Show tokens per second under replies, averaged over the last 10 steps"
          value={decodeSpeed}
          onValueChange={setDecodeSpeed}
        />
        <ToggleRow
          icon="database"
          title="Cache hits"
          detail="Show how much of the prompt the server had cached over the last 10 steps"
          value={cacheHits}
          onValueChange={setCacheHits}
        />
        <Row
          icon="minimize-2"
          title="Auto-compression"
          value={`${compression.trigger}% → ${compression.target}%`}
          onPress={() => router.push('/settings/context')}
        />
      </Section>

      <Section
        title="Sending during a reply"
        footer={
          followUp === 'steer'
            ? 'Messages join the reply at its next step, so the model can change course mid-task.'
            : 'Messages wait above the box and go out one by one when the reply is done. Steer any of them in early from there.'
        }
      >
        <View style={styles.segment}>
          <SegmentedControl options={FOLLOW_UPS} value={followUp} onChange={setFollowUp} />
        </View>
      </Section>

      <Section title="Appearance">
        <View style={styles.segment}>
          <SegmentedControl options={THEMES} value={theme} onChange={setTheme} />
        </View>
      </Section>

      {updatesSupported && (
        <Section
          title="Updates"
          footer={
            prereleases
              ? "New versions come from the app's GitHub releases, including pre-releases: early builds that may be unfinished."
              : "New versions come from the app's GitHub releases."
          }
        >
          <UpdateRow />
          <ToggleRow
            icon="power"
            title="Check on launch"
            detail="Look for a new version when Clanker opens, at most once a day"
            value={checkOnLaunch}
            onValueChange={setCheckOnLaunch}
          />
          <ToggleRow
            icon="git-branch"
            title="Include pre-releases"
            detail="Offer beta builds as well as stable releases"
            value={prereleases}
            onValueChange={setPrereleases}
          />
        </Section>
      )}

      <Text style={[styles.version, { color: colors.textTertiary }]}>Clanker {Constants.expoConfig?.version ?? ''}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  segment: { padding: 12 },
  version: { textAlign: 'center', fontSize: 13, marginTop: 4 },
});
