import Feather from '@expo/vector-icons/Feather';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Row, Section } from '@/components/Form';
import { useTheme } from '@/lib/theme';
import { useMemory } from '@/store/memory';
import { useProjects, type ProjectMemory } from '@/store/projects';

const MEMORY: { value: ProjectMemory; title: string; detail: string }[] = [
  {
    value: 'default',
    title: 'Default memory',
    detail: 'This project can access memory from outside chats, and vice versa.',
  },
  {
    value: 'project',
    title: 'Project-only memory',
    detail: 'This project can only access its own memory. Its memory and chats are hidden from outside chats.',
  },
];

/** Creates a project (no id) or edits one's name and memory. */
export default function EditProjectScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const project = useProjects((s) => (id ? s.projects[id] : undefined));
  const projectMemories = useMemory((s) => (id ? s.memories.filter((m) => m.projectId === id).length : 0));
  const [name, setName] = useState(project?.name ?? '');
  const [memory, setMemory] = useState<ProjectMemory>(project?.memory ?? 'default');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name the project', 'A project needs a name.');
      return;
    }
    const store = useProjects.getState();
    if (project) {
      store.update(project.id, { name: trimmed, memory });
      router.back();
    } else {
      const created = store.create(trimmed, memory);
      router.replace({ pathname: '/projects/[id]', params: { id: created } });
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: project ? 'Edit project' : 'New project',
          headerRight: () => (
            <Pressable onPress={save} hitSlop={10} accessibilityLabel="Save">
              <Feather name="check" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.name, { backgroundColor: colors.surface }]}>
          <Feather name="folder" size={22} color={colors.textSecondary} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Project name"
            placeholderTextColor={colors.textTertiary}
            autoFocus={!project}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={save}
            maxLength={80}
            style={[styles.nameInput, { color: colors.text }]}
          />
        </View>

        <Text style={[styles.label, { color: colors.textSecondary }]}>Memory</Text>
        {MEMORY.map((m) => {
          const selected = memory === m.value;
          return (
            <Pressable
              key={m.value}
              onPress={() => setMemory(m.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [
                styles.option,
                { borderColor: selected ? colors.text : colors.border, borderWidth: selected ? 1.5 : 1 },
                pressed && { backgroundColor: colors.surface },
              ]}
            >
              <Text style={[styles.optionTitle, { color: colors.text }]}>{m.title}</Text>
              <Text style={[styles.optionDetail, { color: colors.textSecondary }]}>{m.detail}</Text>
            </Pressable>
          );
        })}
        {project && memory !== project.memory && (
          <Text style={[styles.note, { color: colors.textTertiary }]}>
            {memory === 'project'
              ? "From now on this project's chats see only memories saved in the project. Memories saved so far stay outside it."
              : `This project's chats will see and save your shared memories.${
                  projectMemories ? ` Its ${projectMemories} project-only memor${projectMemories === 1 ? 'y is' : 'ies are'} kept for if you switch back.` : ''
                }`}
          </Text>
        )}

        {project && project.memory === 'project' && memory === 'project' && (
          <Section style={styles.memories}>
            <Row
              icon="bookmark"
              title="Project memories"
              value={String(projectMemories)}
              onPress={() => router.push({ pathname: '/settings/memory', params: { project: project.id } })}
            />
          </Section>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  name: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 28, paddingHorizontal: 20, minHeight: 64 },
  nameInput: { flex: 1, fontSize: 17, paddingVertical: 14 },
  label: { fontSize: 15, marginTop: 28, marginBottom: 12, marginLeft: 4 },
  option: { borderRadius: 24, paddingHorizontal: 20, paddingVertical: 16, marginBottom: 12, gap: 4 },
  optionTitle: { fontSize: 17 },
  optionDetail: { fontSize: 15, lineHeight: 21 },
  note: { fontSize: 13, lineHeight: 18, marginHorizontal: 8, marginBottom: 12 },
  memories: { marginTop: 16 },
});
