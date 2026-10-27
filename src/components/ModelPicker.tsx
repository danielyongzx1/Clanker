import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PROVIDER_LABELS } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { useSettings, type ModelRef } from '@/store/settings';

type Props = {
  visible: boolean;
  onClose: () => void;
  onManage: () => void;
};

export function ModelPicker({ visible, onClose, onManage }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const endpoints = useSettings((s) => s.endpoints);
  const active = useSettings((s) => s.active);
  const setActive = useSettings((s) => s.setActive);
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return endpoints
      .map((e) => ({
        endpoint: e,
        data: e.models.filter((m) => !q || m.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)),
      }))
      .filter((s) => s.data.length > 0);
  }, [endpoints, query]);

  const totalModels = endpoints.reduce((n, e) => n + e.models.length, 0);

  const choose = (ref: ModelRef) => {
    setActive(ref);
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + 8, borderColor: colors.border },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <Text style={[styles.title, { color: colors.text }]}>Models</Text>

        {totalModels > 8 && (
          <View style={[styles.search, { backgroundColor: colors.surface }]}>
            <Feather name="search" size={16} color={colors.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search models"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
        )}

        <SectionList
          sections={sections}
          keyExtractor={(model, i) => `${model}-${i}`}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          style={styles.list}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.section, { color: colors.textTertiary }]}>
              {section.endpoint.name} · {PROVIDER_LABELS[section.endpoint.type]}
            </Text>
          )}
          renderItem={({ item, section }) => {
            const selected = active?.endpointId === section.endpoint.id && active.model === item;
            return (
              <Pressable
                onPress={() => choose({ endpointId: section.endpoint.id, model: item })}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
              >
                <Text numberOfLines={1} style={[styles.model, { color: colors.text }]}>
                  {item}
                </Text>
                {selected && <Feather name="check" size={18} color={colors.text} />}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {endpoints.length ? 'No models match.' : 'No endpoints yet. Add one to start chatting.'}
            </Text>
          }
        />

        <Pressable
          onPress={() => {
            onClose();
            onManage();
          }}
          style={({ pressed }) => [styles.manage, { borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}
        >
          <Feather name="settings" size={18} color={colors.text} />
          <Text style={[styles.model, { color: colors.text }]}>Manage endpoints</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  grabber: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  list: { flexGrow: 0 },
  section: { fontSize: 13, fontWeight: '500', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  model: { fontSize: 16, flexShrink: 1 },
  empty: { textAlign: 'center', padding: 24, fontSize: 15 },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
});
