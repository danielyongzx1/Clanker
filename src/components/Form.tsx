import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps } from 'react-native';
import { useTheme } from '@/lib/theme';

/** Form pieces shared by the settings screens. */

export function Label({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.textSecondary }]}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, { color: colors.text, backgroundColor: colors.surface }, props.style]}
    />
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: selected ? colors.text : colors.border, backgroundColor: selected ? colors.surface : 'transparent' },
      ]}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '500', marginTop: 20, marginBottom: 8, marginLeft: 4 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
