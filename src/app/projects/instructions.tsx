import Feather from '@expo/vector-icons/Feather';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useTheme } from '@/lib/theme';
import { MAX_INSTRUCTIONS_CHARS, useProjects } from '@/store/projects';

/** A project's custom instructions, sent with every chat in it. */
export default function ProjectInstructionsScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProjects((s) => s.projects[id]);
  const [text, setText] = useState(project?.instructions ?? '');

  const save = () => {
    if (project) useProjects.getState().update(project.id, { instructions: text.trim() });
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: 'Instructions',
          headerRight: () => (
            <Pressable onPress={save} hitSlop={10} accessibilityLabel="Save">
              <Feather name="check" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: colors.text }]}>How should Clanker respond?</Text>
        <Text style={[styles.intro, { color: colors.text }]}>
          You can ask models to focus on certain topics, or to use a certain tone or format for responses in{' '}
          {project ? `"${project.name}"` : 'this project'}.
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={'e.g. "Reference the latest JavaScript documentation. Keep answers short and focused."'}
          placeholderTextColor={colors.textTertiary}
          multiline
          autoFocus
          maxLength={MAX_INSTRUCTIONS_CHARS}
          style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderBottomColor: colors.textSecondary }]}
        />
        <Text style={[styles.count, { color: colors.textTertiary }]}>
          {text.length} / {MAX_INSTRUCTIONS_CHARS}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  intro: { fontSize: 16, lineHeight: 23, marginBottom: 24 },
  input: {
    minHeight: 160,
    maxHeight: 420,
    fontSize: 16,
    lineHeight: 23,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomWidth: 1,
    textAlignVertical: 'top',
  },
  count: { fontSize: 12, textAlign: 'right', marginTop: 6 },
});
