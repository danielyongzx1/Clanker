import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Input, Label, Row, Section } from '@/components/Form';
import { RemoteAdapter } from '@/lib/remote/client';
import { bridgeAddresses } from '@/lib/remote/addresses';
import type { RemoteBackend } from '@/lib/remote/types';
import { apiKeys } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { useBackends } from '@/store/backends';

export default function BackendsScreen() {
  const { colors } = useTheme();
  const remotes = useBackends((s) => s.remotes);
  const [editing, setEditing] = useState<string | null>(null);
  const existing = remotes.find((b) => b.id === editing);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [altUrls, setAltUrls] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [token, setToken] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const edit = (backend?: RemoteBackend) => {
    setEditing(backend?.id ?? null); setName(backend?.name ?? ''); setUrl(backend?.baseUrl ?? '');
    setAltUrls(backend?.altBaseUrls ?? []); setModelQuery('');
    setModel(backend?.model ?? ''); setModels(backend?.models ?? []); setToken(''); setStatus('');
  };
  useEffect(() => {
    let active = true;
    if (existing) void apiKeys.get(`bridge_${existing.id}`).then((key) => { if (active) setToken(key ?? ''); });
    return () => { active = false; };
  }, [existing]);
  const test = async (save: boolean) => {
    setBusy(true); setStatus('Connecting…');
    try {
      const parsed = new URL(url.trim());
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter an HTTP(S) bridge address without credentials or query parameters.');
      const draft: RemoteBackend = { id: existing?.id ?? 'test', name: name.trim(), kind: existing?.kind ?? 'hermes', baseUrl: url.trim().replace(/\/+$/, ''), altBaseUrls: altUrls.map((value) => value.trim()).filter(Boolean), bridgeId: existing?.bridgeId ?? '', models: [], model };
      bridgeAddresses(draft);
      const info = await new RemoteAdapter(draft, token.trim()).info();
      if (!info.models.length) throw new Error('The backend has no available models. Configure its model provider on the host first.');
      const chosen = info.models.includes(model) ? model : info.models[0];
      setModels(info.models); setModel(chosen);
      if (save) {
        const backend = { ...draft, id: existing?.id ?? `remote_${info.bridgeId}`, name: draft.name || (info.kind === 'hermes' ? 'Hermes' : 'DeepSeek Harness'), kind: info.kind, bridgeId: info.bridgeId, models: info.models, model: chosen, modelOptions: info.modelOptions, efforts: existing?.efforts };
        await apiKeys.set(`bridge_${backend.id}`, token.trim());
        useBackends.getState().save(backend); setEditing(backend.id);
      }
      setStatus(`${save ? 'Saved' : 'Connected'} · ${info.kind === 'hermes' ? 'Hermes' : 'DeepSeek Harness'} · ${info.models.length} model(s)`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 50 }} keyboardShouldPersistTaps="handled">
      <Section title="Backends" footer="Choose a backend on an empty chat. Existing chats keep their backend and model.">
        <Row title="Clanker" detail="Built-in agent · tools on this phone" />
        {remotes.map((backend) => <Row key={backend.id} title={backend.name} detail={backend.baseUrl} selected={editing === backend.id} onPress={() => edit(backend)} />)}
        <Row icon="plus" title="Add remote backend" onPress={() => edit()} />
      </Section>
      <Label>{existing ? 'Edit connection' : 'New connection'}</Label>
      <Input placeholder="Name, e.g. Hermes — Desktop" value={name} onChangeText={setName} editable={!busy} />
      <Input placeholder="Bridge address, e.g. http://192.168.1.10:8787" value={url} onChangeText={setUrl} keyboardType="url" editable={!busy} />
      {!!altUrls.length && <Label>Alternative addresses for the same backend</Label>}
      {altUrls.map((value, index) => <View key={index} style={{ gap: 4 }}>
        <Input accessibilityLabel={`Alternative address ${index + 1}`} placeholder="VPN or HTTPS bridge address" value={value} onChangeText={(text) => setAltUrls((current) => current.map((entry, i) => i === index ? text : entry))} keyboardType="url" editable={!busy} />
        <Pressable disabled={busy} accessibilityRole="button" onPress={() => setAltUrls((current) => current.filter((_, i) => i !== index))}><Text style={{ color: colors.link, paddingVertical: 8 }}>Remove address</Text></Pressable>
      </View>)}
      <Row icon="plus" title="Add alternative address" disabled={busy} onPress={() => setAltUrls((current) => [...current, ''])} />
      <Input placeholder="Bridge token" value={token} onChangeText={setToken} secureTextEntry editable={!busy} />
      {!!models.length && <>
        <Input placeholder="Search models or providers" value={modelQuery} onChangeText={setModelQuery} />
        <Section title="Model for new chats" footer={`Selected: ${model || 'None'}`}>{models.filter((entry) => entry.toLowerCase().includes(modelQuery.trim().toLowerCase())).map((entry) => <Row key={entry} title={entry} selected={model === entry} onPress={() => setModel(entry)} />)}</Section>
      </>}
      <View style={{ flexDirection: 'row', gap: 24, paddingVertical: 12 }}>
        <Pressable disabled={busy} onPress={() => void test(false)} accessibilityRole="button"><Text style={{ color: colors.link }}>{busy ? 'Connecting…' : 'Test connection'}</Text></Pressable>
        <Pressable disabled={busy} onPress={() => void test(true)} accessibilityRole="button"><Text style={{ color: colors.link, fontWeight: '600' }}>Save</Text></Pressable>
      </View>
      {!!status && <Text accessibilityLiveRegion="polite" selectable style={{ color: colors.textSecondary }}>{status}</Text>}
      {existing && <Row title="Remove connection" tint="danger" onPress={() => Alert.alert('Remove connection?', 'Chats and remote files remain. Restoring the same bridge reconnects its chats.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { useBackends.getState().remove(existing.id); edit(); } }])} />}
      <Section title="Remote device setup" footer="Remote chats use the agent’s own history and memory. They are stored on the host; temporary-chat mode does not apply.">
        <Row title="1. Run the companion bridge" detail="Install tools/remote-bridge on the device running Hermes or DeepSeek Harness. Follow its README for the exact commands." />
        <Row title="2. Configure the agent" detail="Hermes: enable its API server and set its key. Harness: start dsh web --no-open and give the bridge its launch token. Both agents must see the bridge workspace directory." />
        <Row title="3. Connect this phone" detail="Use the host’s LAN/VPN address and the bridge token. Use HTTPS when connecting over the internet. Keep upstream credentials on the host." />
      </Section>
    </ScrollView>
  );
}
