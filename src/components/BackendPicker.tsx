import { useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Input, Row, Section } from './Form';
import { useBackends } from '@/store/backends';
import { useTheme } from '@/lib/theme';

export function BackendPicker({ visible, onClose, onManage }: { visible: boolean; onClose: () => void; onManage: () => void }) {
  const { colors } = useTheme();
  const { selected, remotes, select } = useBackends();
  const choose = (id: string) => { select(id); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 64, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '600' }}>Choose backend</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}><Text style={{ color: colors.link }}>Done</Text></Pressable>
        </View>
        <ScrollView>
          <Section footer="Chosen before the first message. Each chat keeps its backend.">
            <Row title="Clanker" detail="Tools run on this phone" selected={selected === 'local'} onPress={() => choose('local')} />
            {remotes.map((backend) => <Row key={backend.id} title={backend.name} detail={`${backend.kind === 'hermes' ? 'Hermes' : 'DeepSeek Harness'} · ${backend.model}`} selected={selected === backend.id} onPress={() => choose(backend.id)} />)}
          </Section>
          <Row icon="server" title="Manage backends" onPress={() => { onClose(); onManage(); }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export function RemoteModelPicker({ backendId, visible, onClose }: { backendId: string; visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const backend = useBackends((state) => state.remotes.find((entry) => entry.id === backendId));
  const [query, setQuery] = useState('');
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 64, paddingHorizontal: 20, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '600' }}>Choose model</Text>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}><Text style={{ color: colors.link }}>Done</Text></Pressable>
      </View>
      <Input placeholder="Search models or providers" value={query} onChangeText={setQuery} />
      <FlatList keyboardShouldPersistTaps="handled" data={(backend?.models ?? []).filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()))} keyExtractor={(model) => model}
        renderItem={({ item }) => <Row title={item} selected={backend?.model === item} onPress={() => {
          if (backend) useBackends.getState().save({ ...backend, model: item });
          setQuery(''); onClose();
        }} />}
        ListEmptyComponent={<Text style={{ color: colors.textSecondary }}>No matching models. Refresh this connection in Settings → Backends.</Text>} />
    </View>
  </Modal>;
}
