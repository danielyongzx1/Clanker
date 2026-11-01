import Feather from '@expo/vector-icons/Feather';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Disclosure, Input, Label, Row, Section } from '@/components/Form';
import { bridgeAddresses } from '@/lib/remote/addresses';
import { RemoteAdapter } from '@/lib/remote/client';
import type { RemoteBackend } from '@/lib/remote/types';
import { apiKeys } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { useBackends } from '@/store/backends';

const KIND_LABELS: Record<RemoteBackend['kind'], string> = { hermes: 'Hermes', harness: 'DeepSeek Harness' };

const STEPS = [
  {
    title: 'Run the companion bridge',
    text: 'Install tools/remote-bridge on the device running Hermes or DeepSeek Harness. Its README has the exact commands.',
  },
  {
    title: 'Configure the agent',
    text: 'Hermes: enable its API server and set its key. Harness: start dsh web --no-open and give the bridge its launch token. Both agents must see the bridge workspace directory.',
  },
  {
    title: 'Connect this phone',
    text: 'Enter the host’s LAN or VPN address and the bridge token below. Use HTTPS over the internet; upstream credentials stay on the host.',
  },
];

/** Adds or edits a remote backend: a Hermes or DeepSeek Harness agent reached through its bridge. */
export default function BackendScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useBackends((s) => s.remotes.find((b) => b.id === id));

  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState(existing?.baseUrl ?? '');
  const [altUrls, setAltUrls] = useState<string[]>(existing?.altBaseUrls ?? []);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [models, setModels] = useState<string[]>(existing?.models ?? []);
  const [model, setModel] = useState(existing?.model ?? '');
  const [modelFilter, setModelFilter] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Keyed on the id: the backend is re-saved whenever its model list refreshes, which mustn't
  // overwrite a token being edited.
  const existingId = existing?.id;
  useEffect(() => {
    if (existingId) void apiKeys.get(`bridge_${existingId}`).then((key) => key && setToken(key));
  }, [existingId]);

  /** Reaches the bridge, and saves the backend once it answers when `save` is set. */
  const connect = async (save: boolean) => {
    setBusy(save ? 'save' : 'test');
    setStatus(null);
    try {
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        throw new Error('Enter the bridge address, such as http://192.168.1.10:8787.');
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('Enter an HTTP(S) bridge address without credentials or query parameters.');
      }
      const draft: RemoteBackend = {
        id: existing?.id ?? 'test',
        name: name.trim(),
        kind: existing?.kind ?? 'hermes',
        baseUrl: url.trim().replace(/\/+$/, ''),
        altBaseUrls: altUrls.map((value) => value.trim()).filter(Boolean),
        bridgeId: existing?.bridgeId ?? '',
        models: [],
        model,
      };
      bridgeAddresses(draft);
      const info = await new RemoteAdapter(draft, token.trim()).info();
      if (!info.models.length) throw new Error('The backend has no available models. Configure its model provider on the host first.');
      const chosen = info.models.includes(model) ? model : info.models[0];
      setModels(info.models);
      setModel(chosen);
      if (save) {
        const backend: RemoteBackend = {
          ...draft,
          id: existing?.id ?? `remote_${info.bridgeId}`,
          name: draft.name || KIND_LABELS[info.kind],
          kind: info.kind,
          bridgeId: info.bridgeId,
          models: info.models,
          model: chosen,
          modelOptions: info.modelOptions,
          efforts: existing?.efforts,
        };
        await apiKeys.set(`bridge_${backend.id}`, token.trim());
        useBackends.getState().save(backend);
        router.back();
        return;
      }
      setStatus({
        ok: true,
        text: `Connected to ${KIND_LABELS[info.kind]} · ${info.models.length} model${info.models.length === 1 ? '' : 's'}.`,
      });
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setStatus({ ok: false, text });
      if (save) Alert.alert('Could not save', `Clanker saves a backend once its bridge answers.\n\n${text}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert('Remove backend?', 'Chats and remote files remain. Adding the same bridge again reconnects its chats.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          useBackends.getState().remove(existing!.id);
          router.back();
        },
      },
    ]);

  const visibleModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    return q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  }, [models, modelFilter]);

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: existing ? 'Edit backend' : 'Add backend',
          headerRight: () =>
            busy === 'save' ? (
              <ActivityIndicator size="small" color={colors.link} />
            ) : (
              <Pressable onPress={() => void connect(true)} disabled={!!busy} hitSlop={10}>
                <Text style={{ color: colors.link, fontSize: 17, fontWeight: '600' }}>Save</Text>
              </Pressable>
            ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Disclosure title="Setting up the host" initiallyOpen={!existing}>
          <View style={[styles.steps, { backgroundColor: colors.surface }]}>
            {STEPS.map((step, i) => (
              <View key={step.title} style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: colors.background }]}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '500' }}>{step.title}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18 }}>{step.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </Disclosure>

        <Label>Name</Label>
        <Input value={name} onChangeText={setName} placeholder="Hermes — Desktop" autoCapitalize="words" editable={!busy} />

        <Label>Bridge address</Label>
        <Input value={url} onChangeText={setUrl} placeholder="http://192.168.1.10:8787" keyboardType="url" editable={!busy} />
        {altUrls.map((value, i) => (
          <View key={i} style={[styles.addRow, { marginTop: 8 }]}>
            <Input
              accessibilityLabel={`Alternative address ${i + 1}`}
              value={value}
              onChangeText={(text) => setAltUrls(altUrls.map((u, j) => (j === i ? text : u)))}
              placeholder="VPN or HTTPS bridge address"
              keyboardType="url"
              editable={!busy}
              style={{ flex: 1 }}
            />
            <Pressable
              onPress={() => setAltUrls(altUrls.filter((_, j) => j !== i))}
              disabled={!!busy}
              hitSlop={8}
              accessibilityLabel={`Remove alternative address ${i + 1}`}
              style={styles.removeUrl}
            >
              <Feather name="x" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))}
        <Pressable onPress={() => setAltUrls([...altUrls, ''])} disabled={!!busy} hitSlop={6} style={styles.addUrl}>
          <Feather name="plus" size={16} color={colors.link} />
          <Text style={{ color: colors.link, fontSize: 15, fontWeight: '500' }}>Add alternative address</Text>
        </Pressable>
        {altUrls.length > 0 && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            Other routes to the same bridge, such as a VPN or HTTPS address for when you&apos;re away from home.
          </Text>
        )}

        <Label>Bridge token</Label>
        <View>
          <Input
            value={token}
            onChangeText={setToken}
            placeholder="From the bridge on the host"
            secureTextEntry={!showToken}
            editable={!busy}
            style={{ paddingRight: 44 }}
          />
          <Pressable
            onPress={() => setShowToken(!showToken)}
            hitSlop={8}
            accessibilityLabel={showToken ? 'Hide token' : 'Show token'}
            style={styles.eye}
          >
            <Feather name={showToken ? 'eye-off' : 'eye'} size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => void connect(false)}
          disabled={!!busy}
          style={({ pressed }) => [styles.button, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
        >
          {busy === 'test' ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Feather name="zap" size={16} color={colors.text} />
          )}
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>
            {models.length ? 'Test and refresh models' : 'Test connection'}
          </Text>
        </Pressable>

        {status && (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.status, { backgroundColor: status.ok ? colors.surface : colors.dangerBg }]}
          >
            <Feather name={status.ok ? 'check-circle' : 'alert-circle'} size={16} color={status.ok ? colors.text : colors.danger} />
            <Text selectable style={{ flex: 1, color: status.ok ? colors.text : colors.danger, fontSize: 14, lineHeight: 20 }}>
              {status.text}
            </Text>
          </View>
        )}

        {/* Slides along as the status above comes and goes. */}
        <Animated.View layout={LinearTransition.duration(220)}>
          {models.length > 0 && (
            <>
              <Label>Model for new chats</Label>
              {models.length > 10 && (
                <Input value={modelFilter} onChangeText={setModelFilter} placeholder="Search models or providers" style={{ marginBottom: 8 }} />
              )}
              <Section inset={16} footer="Each chat keeps the model it started with; pick another for a new chat from the chat title.">
                {visibleModels.slice(0, 200).map((m) => (
                  <Row key={m} title={m} selected={model === m} onPress={() => setModel(m)} accessibilityRole="radio" accessibilityState={{ checked: model === m }} />
                ))}
                {!visibleModels.length && <Row title="No models match" />}
              </Section>
              {visibleModels.length > 200 && (
                <Text style={[styles.hint, { color: colors.textTertiary, marginTop: -20, marginBottom: 20 }]}>
                  {visibleModels.length - 200} more. Search to find them.
                </Text>
              )}
            </>
          )}

          <Text style={[styles.hint, { color: colors.textTertiary, marginTop: models.length ? 0 : 20 }]}>
            Remote chats use the agent&apos;s own history and memory, stored on the host, so temporary-chat mode doesn&apos;t
            apply to them.
          </Text>

          {existing && (
            <Pressable onPress={remove} style={({ pressed }) => [styles.button, styles.delete, pressed && { opacity: 0.6 }]}>
              <Feather name="trash-2" size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '500' }}>Remove backend</Text>
            </Pressable>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 60 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 6, marginHorizontal: 4 },
  steps: { borderRadius: 16, padding: 16, gap: 16, marginTop: 12 },
  step: { flexDirection: 'row', gap: 12 },
  stepNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eye: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addUrl: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, marginHorizontal: 4 },
  removeUrl: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 13,
    marginTop: 28,
  },
  status: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 12, marginTop: 12 },
  delete: { borderWidth: 0, marginTop: 16 },
});
