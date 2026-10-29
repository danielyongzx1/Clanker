import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Section } from '@/components/Form';
import { Slider } from '@/components/Slider';
import { useTheme } from '@/lib/theme';
import { useSettings } from '@/store/settings';

const STEP = 5;
// The target always stays this far below the trigger; moving one slider past it pushes the other.
const GAP = 10;
const TRIGGER = { min: 20, max: 95 };
const TARGET = { min: 10, max: TRIGGER.max - GAP };

const percent = (v: number) => `${v}%`;

function SliderCard({ value, children }: { value: number; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color: colors.text }]}>
        {value}%<Text style={[styles.unit, { color: colors.textTertiary }]}> of the context budget</Text>
      </Text>
      {children}
    </View>
  );
}

// Read from the store rather than from render, since a drag can outlive the render it began in.
const setTrigger = (trigger: number) => {
  const { compression, setCompression } = useSettings.getState();
  setCompression({ trigger, target: Math.min(compression.target, trigger - GAP) });
};

const setTarget = (target: number) => {
  const { compression, setCompression } = useSettings.getState();
  setCompression({ trigger: Math.max(compression.trigger, target + GAP), target });
};

/** When the app compresses a long chat's history on its own, and how far. */
export default function ContextScreen() {
  const { colors } = useTheme();
  const { trigger, target } = useSettings((s) => s.compression);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: colors.textTertiary }]}>
        Once a chat fills the model&apos;s context budget past the point set below, the oldest messages are condensed
        before the next request.
        Your latest message is always kept in full. You set the budget for each model on its endpoint.
      </Text>

      <Section
        title="Compress at"
        footer="How full the budget gets before compressing. Higher keeps more history verbatim, but leaves less room for long replies and tool output."
      >
        <SliderCard value={trigger}>
          <Slider
            value={trigger}
            {...TRIGGER}
            step={STEP}
            format={percent}
            accessibilityLabel="Compress at"
            onChange={setTrigger}
          />
        </SliderCard>
      </Section>

      <Section
        title="Compress down to"
        footer="How much of the budget is left in use afterwards. Lower means compressing less often, but more of the older conversation is condensed each time."
      >
        <SliderCard value={target}>
          <Slider
            value={target}
            {...TARGET}
            step={STEP}
            format={percent}
            accessibilityLabel="Compress down to"
            onChange={setTarget}
          />
        </SliderCard>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginBottom: 24 },
  card: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, gap: 6 },
  value: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 15, fontWeight: '400' },
});
