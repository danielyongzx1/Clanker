import { ActivityAction, startActivityAsync } from 'expo-intent-launcher';
import { useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Row, Section, ToggleRow } from '@/components/Form';
import { Slider } from '@/components/Slider';
import { entryAvailable, phoneAvailable, phoneSupported } from '@/lib/tools';
import { entryOn, LOCAL_TOOL_GROUPS } from '@/lib/tools/catalog';
import { useTheme } from '@/lib/theme';
import { useSettings } from '@/store/settings';

// Where the slider starts when a limit is first turned on.
const DEFAULT_LIMIT = 50;
const LIMIT = { min: 10, max: 200, step: 10 };

/** Whether Clanker's accessibility service is on, checked again whenever the app comes back to the front. */
function usePhoneService() {
  const [on, setOn] = useState(phoneAvailable);
  useEffect(() => {
    if (!phoneSupported()) return;
    const sub = AppState.addEventListener('change', (state) => state === 'active' && setOn(phoneAvailable()));
    return () => sub.remove();
  }, []);
  return on;
}

/** Turns the agent's file, code, phone and history tools on and off one at a time. */
export default function ToolsScreen() {
  const { colors } = useTheme();
  const tools = useSettings((s) => s.tools);
  const disabled = useSettings((s) => s.disabledTools);
  const setToolsEnabled = useSettings((s) => s.setToolsEnabled);
  const maxSteps = useSettings((s) => s.maxSteps);
  const setMaxSteps = useSettings((s) => s.setMaxSteps);
  const phoneOn = usePhoneService();

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      {!tools && (
        <Text style={[styles.notice, { color: colors.textTertiary }]}>
          Files & code is off, so models get none of these tools. Turn it on in Settings.
        </Text>
      )}
      <Section
        title="Limits"
        footer="Stops a reply after this many rounds of tool calls, so a confused model can't keep going forever. Off, models work until they're done or you stop them."
        inset={16}
      >
        <ToggleRow
          title="Limit tool rounds"
          value={maxSteps != null}
          onValueChange={(on) => setMaxSteps(on ? DEFAULT_LIMIT : null)}
          disabled={!tools}
        />
        {maxSteps != null && (
          <View style={[styles.card, !tools && styles.off]}>
            <Text style={[styles.value, { color: colors.text }]}>
              {maxSteps}
              <Text style={[styles.unit, { color: colors.textTertiary }]}> rounds per reply</Text>
            </Text>
            <Slider value={maxSteps} {...LIMIT} accessibilityLabel="Tool rounds per reply" onChange={setMaxSteps} />
          </View>
        )}
      </Section>
      {LOCAL_TOOL_GROUPS.filter((group) => group.tools.some(entryAvailable)).map((group) => (
        <Section key={group.title} title={group.title} footer={group.footer} inset={16}>
          {group.tools.some((entry) => entry.names.includes('phone_screen')) && (
            <Row
              icon="smartphone"
              title="Accessibility service"
              value={phoneOn ? 'On' : 'Off'}
              onPress={() => void startActivityAsync(ActivityAction.ACCESSIBILITY_SETTINGS)}
            />
          )}
          {group.tools
            .filter(entryAvailable)
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
  card: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 6 },
  off: { opacity: 0.4, pointerEvents: 'none' },
  value: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 15, fontWeight: '400' },
});
