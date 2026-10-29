import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Row, Section, ToggleRow } from '@/components/Form';
import { entryOn, MEMORY_TOOLS } from '@/lib/tools/catalog';
import { useTheme } from '@/lib/theme';
import { MAX_MEMORY_CHARS, MAX_TOTAL_CHARS, useMemory, type Memory } from '@/store/memory';
import { useSettings } from '@/store/settings';

const SOURCES: Record<Memory['source'], string> = {
  model: 'Saved by a model',
  auto: 'Saved automatically',
  user: 'Added by you',
};

function when(ms: number) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString();
}

function report(e: unknown) {
  Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
}

/** What the models remember about the user, and how they come to remember it. */
export default function MemoryScreen() {
  const { colors } = useTheme();
  const memories = useMemory((s) => s.memories);
  const memory = useSettings((s) => s.memory);
  const setMemory = useSettings((s) => s.setMemory);
  const memoryAuto = useSettings((s) => s.memoryAuto);
  const setMemoryAuto = useSettings((s) => s.setMemoryAuto);
  const tools = useSettings((s) => s.tools);
  const disabled = useSettings((s) => s.disabledTools);
  const setToolsEnabled = useSettings((s) => s.setToolsEnabled);

  // The memory being edited; an empty id is a new one.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const save = () => {
    if (!editing) return;
    const store = useMemory.getState();
    try {
      if (editing.id) store.update(editing.id, editing.text);
      else store.add(editing.text, 'user');
      setEditing(null);
    } catch (e) {
      report(e);
    }
  };

  const remove = (id: string) => {
    useMemory.getState().remove(id);
    setEditing(null);
  };

  const clearAll = () =>
    Alert.alert('Delete all memories?', 'New chats will start without knowing anything about you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete all', style: 'destructive', onPress: () => useMemory.getState().clear() },
    ]);

  const used = memories.reduce((n, m) => n + m.text.length, 0);
  const newest = [...memories].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: colors.textTertiary }]}>
        Memories are short facts about you that every chat can see, so you don&apos;t have to repeat yourself. Changes
        apply to new chats, and to open chats from your next message when Files &amp; code is on.
      </Text>

      <Section footer="Saving automatically sends one short extra request to the chat's model after each reply. Start a temporary chat from the eye button on a new chat to leave memory out of it.">
        <ToggleRow icon="bookmark" title="Use memory" detail="Chats see your saved memories" value={memory} onValueChange={setMemory} />
        <ToggleRow
          icon="zap"
          title="Save from chats automatically"
          detail="Pick up what's worth remembering after each reply"
          value={memoryAuto && memory}
          onValueChange={setMemoryAuto}
          disabled={!memory}
        />
        {MEMORY_TOOLS.map((entry) => (
          <ToggleRow
            key={entry.title}
            icon={entry.names.includes('search_chats') ? 'search' : 'edit-3'}
            title={entry.title}
            detail={tools ? entry.detail : 'Needs files & code'}
            value={entryOn(entry, disabled) && memory && tools}
            onValueChange={(on) => setToolsEnabled(entry.names, on)}
            disabled={!memory || !tools}
          />
        ))}
      </Section>

      <Section
        title={`Saved memories · ${Math.round((used / MAX_TOTAL_CHARS) * 100)}% full`}
        footer={memories.length ? 'Tap a memory to edit or delete it.' : undefined}
        inset={16}
      >
        {newest.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => setEditing({ id: m.id, text: m.text })}
            style={({ pressed }) => [styles.memory, pressed && { backgroundColor: colors.surfaceHover }]}
          >
            <Text style={[styles.memoryText, { color: colors.text }]}>{m.text}</Text>
            <Text style={[styles.memoryMeta, { color: colors.textTertiary }]}>
              {SOURCES[m.source]} · {when(m.updatedAt)}
            </Text>
          </Pressable>
        ))}
        {!memories.length && (
          <View style={styles.empty}>
            <Feather name="bookmark" size={24} color={colors.textTertiary} />
            <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
              Nothing saved yet. Tell a model something about yourself, or ask it to remember something.
            </Text>
          </View>
        )}
        <Row icon="plus" title="Add memory" tint="link" onPress={() => setEditing({ id: '', text: '' })} />
      </Section>

      {memories.length > 0 && (
        <Pressable onPress={clearAll} style={styles.clear} hitSlop={6}>
          <Text style={{ color: colors.danger, fontSize: 16 }}>Delete all memories</Text>
        </Pressable>
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={() => setEditing(null)}>
          <Pressable style={[styles.dialog, { backgroundColor: colors.background }]}>
            <Text style={[styles.dialogTitle, { color: colors.text }]}>{editing?.id ? 'Edit memory' : 'Add memory'}</Text>
            <TextInput
              value={editing?.text ?? ''}
              onChangeText={(text) => editing && setEditing({ ...editing, text })}
              placeholder="e.g. Prefers metric units"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              multiline
              maxLength={MAX_MEMORY_CHARS}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            />
            <View style={styles.buttons}>
              {!!editing?.id && (
                <Pressable onPress={() => remove(editing.id)} style={[styles.button, styles.delete]}>
                  <Text style={{ color: colors.danger, fontSize: 16 }}>Delete</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setEditing(null)} style={styles.button}>
                <Text style={{ color: colors.textSecondary, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} style={[styles.button, { backgroundColor: colors.sendBg }]}>
                <Text style={{ color: colors.sendFg, fontSize: 16, fontWeight: '600' }}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  intro: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginBottom: 24 },
  memory: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  memoryText: { fontSize: 16, lineHeight: 22 },
  memoryMeta: { fontSize: 13 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 28 },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  clear: { alignSelf: 'center', marginTop: 4, padding: 8 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 32 },
  dialog: { borderRadius: 20, padding: 20, gap: 16 },
  dialogTitle: { fontSize: 18, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  delete: { marginRight: 'auto', paddingLeft: 0 },
});
