import { ScrollView, StyleSheet, Text } from 'react-native';
import { Section, ToggleRow } from '@/components/Form';
import { shellAvailable } from '@/lib/tools';
import { entryOn, LOCAL_TOOL_GROUPS } from '@/lib/tools/catalog';
import { useTheme } from '@/lib/theme';
import { useSettings } from '@/store/settings';

/** Turns the agent's file, code and history tools on and off one at a time. */
export default function ToolsScreen() {
  const { colors } = useTheme();
  const tools = useSettings((s) => s.tools);
  const disabled = useSettings((s) => s.disabledTools);
  const setToolsEnabled = useSettings((s) => s.setToolsEnabled);
  const shell = shellAvailable();

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {!tools && (
        <Text style={[styles.notice, { color: colors.textTertiary }]}>
          Files & code is off, so models get none of these tools. Turn it on in Settings.
        </Text>
      )}
      {LOCAL_TOOL_GROUPS.map((group) => (
        <Section key={group.title} title={group.title} footer={group.footer} inset={16}>
          {group.tools
            .filter((entry) => shell || !entry.names.includes('run_shell'))
            .map((entry) => (
              <ToggleRow
                key={entry.title}
                title={entry.title}
                detail={entry.detail}
                value={entryOn(entry, disabled)}
                onValueChange={(on) => setToolsEnabled(entry.names, on)}
                disabled={!tools}
              />
            ))}
        </Section>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  notice: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginBottom: 20 },
});
