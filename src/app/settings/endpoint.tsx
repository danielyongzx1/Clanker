import Feather from '@expo/vector-icons/Feather';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Chip, Disclosure, Input, Label } from '@/components/Form';
import {
  getAdapter,
  guessEfforts,
  PRESETS,
  PROVIDER_LABELS,
  resolveBaseUrl,
  type EffortParam,
  type Endpoint,
  type ProviderType,
} from '@/lib/providers';
import { formatTokens, parseTokens } from '@/lib/context';
import { apiKeys, uid } from '@/lib/storage';
import { fonts, useTheme } from '@/lib/theme';
import { resolveBudget, useSettings } from '@/store/settings';

const TYPES: ProviderType[] = ['openai', 'anthropic', 'ollama', 'gemini'];

const EFFORT_PARAMS: { value: EffortParam; label: string }[] = [
  { value: 'reasoning_effort', label: 'OpenAI' },
  { value: 'reasoning', label: 'OpenRouter' },
  { value: 'chat_template_kwargs', label: 'llama.cpp / llama-swap' },
];

function parseHeaders(text: string) {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

export default function EndpointScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useSettings((s) => s.endpoints.find((e) => e.id === id));

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<ProviderType>(existing?.type ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [altUrls, setAltUrls] = useState<string[]>(existing?.altBaseUrls ?? []);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>(existing?.models ?? []);
  const [efforts, setEfforts] = useState<Record<string, string[]>>(existing?.efforts ?? {});
  const [contexts, setContexts] = useState<Record<string, number>>(existing?.contexts ?? {});
  const [budgets, setBudgets] = useState<Record<string, number>>(existing?.budgets ?? {});
  const [effortParam, setEffortParam] = useState<EffortParam>(existing?.effortParam ?? 'reasoning_effort');
  const [editing, setEditing] = useState<{ model: string; field: 'effort' | 'budget'; text: string } | null>(null);
  const [newModel, setNewModel] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [headersText, setHeadersText] = useState(
    Object.entries(existing?.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  );
  const [busy, setBusy] = useState<'fetch' | 'test' | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (existing) apiKeys.get(existing.id).then((k) => k && setApiKey(k));
  }, [existing]);

  const alts = altUrls.map((u) => u.trim()).filter(Boolean);

  const draft = (): Endpoint => ({
    id: existing?.id ?? uid(),
    name: name.trim() || PROVIDER_LABELS[type],
    type,
    baseUrl: baseUrl.trim(),
    ...(alts.length ? { altBaseUrls: alts } : {}),
    models,
    efforts: Object.fromEntries(models.flatMap((m) => (efforts[m]?.length ? [[m, efforts[m]]] : []))),
    contexts: Object.fromEntries(models.flatMap((m) => (contexts[m] ? [[m, contexts[m]]] : []))),
    budgets: Object.fromEntries(models.flatMap((m) => (budgets[m] ? [[m, budgets[m]]] : []))),
    ...(type === 'openai' ? { effortParam } : {}),
    headers: parseHeaders(headersText),
  });

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setType(preset.type);
    setBaseUrl(preset.baseUrl);
    setAltUrls([]);
    setName(preset.name === 'Custom' ? '' : preset.name);
    setModels([]);
    setEfforts({});
    setContexts({});
    setBudgets({});
    setEffortParam(preset.baseUrl.includes('openrouter.ai') ? 'reasoning' : 'reasoning_effort');
    setStatus(null);
  };

  // Names the URL that answered, when there's more than one to pick from.
  const via = async (endpoint: Endpoint) => (alts.length ? ` (via ${await resolveBaseUrl(endpoint)})` : '');

  const fetchModels = async () => {
    if (!baseUrl.trim()) return setStatus({ ok: false, text: 'Enter a base URL first.' });
    setBusy('fetch');
    setStatus(null);
    try {
      const endpoint = draft();
      const { models: list, effortParam: detected } = await getAdapter(type).listModels(
        endpoint,
        apiKey.trim() || undefined
      );
      setModels(list.map((m) => m.id));
      const found = Object.fromEntries(list.flatMap((m) => (m.efforts ? [[m.id, m.efforts]] : [])));
      setEfforts(found);
      setContexts(
        Object.fromEntries(list.flatMap((m) => (m.contextLength && m.contextLength > 0 ? [[m.id, m.contextLength]] : [])))
      );
      if (detected) setEffortParam(detected);
      const withEffort = Object.keys(found).length;
      setStatus({
        ok: true,
        text:
          `Found ${list.length} model${list.length === 1 ? '' : 's'}` +
          (withEffort ? `, ${withEffort} with effort levels` : '') +
          `${await via(endpoint)}.`,
      });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const testConnection = async () => {
    if (!models.length) return setStatus({ ok: false, text: 'Add or fetch at least one model to test.' });
    setBusy('test');
    setStatus(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let reply = '';
    const endpoint = draft();
    try {
      await getAdapter(type).stream({
        endpoint,
        apiKey: apiKey.trim() || undefined,
        model: models[0],
        signal: controller.signal,
        messages: [{ role: 'user', text: 'Reply with exactly one word: OK', images: [] }],
        onToken: (t) => (reply += t),
      });
      setStatus({
        ok: true,
        text: `${models[0]} replied${await via(endpoint)}: ${reply.trim().slice(0, 80) || '(empty)'}`,
      });
    } catch (e) {
      const text = controller.signal.aborted ? 'Timed out after 30 seconds.' : e instanceof Error ? e.message : String(e);
      setStatus({ ok: false, text });
    } finally {
      clearTimeout(timeout);
      setBusy(null);
    }
  };

  const addModel = () => {
    const m = newModel.trim();
    if (m && !models.includes(m)) {
      setModels([...models, m]);
      const guessed = guessEfforts(type, m, effortParam);
      if (guessed) setEfforts({ ...efforts, [m]: guessed });
    }
    setNewModel('');
  };

  const commitEdit = () => {
    if (!editing) return;
    setEditing(null);
    if (editing.field === 'effort') {
      const levels = [...new Set(editing.text.split(/[\s,]+/).filter(Boolean).map((l) => l.toLowerCase()))];
      const { [editing.model]: _, ...rest } = efforts;
      setEfforts(levels.length ? { ...rest, [editing.model]: levels } : rest);
      return;
    }
    const { [editing.model]: _, ...rest } = budgets;
    if (!editing.text.trim()) return setBudgets(rest);
    const tokens = parseTokens(editing.text);
    if (tokens) setBudgets({ ...rest, [editing.model]: tokens });
    else Alert.alert('Invalid context budget', 'Enter a token count such as 32000, 128K or 1M.');
  };

  const save = async () => {
    if (!baseUrl.trim()) return Alert.alert('Missing base URL', 'Enter the URL of the API.');
    if (!models.length) return Alert.alert('No models', 'Fetch the model list or add a model name manually.');
    const endpoint = draft();
    await apiKeys.set(endpoint.id, apiKey.trim());
    useSettings.getState().upsertEndpoint(endpoint);
    router.back();
  };

  const remove = () =>
    Alert.alert('Delete endpoint?', `${existing?.name} and its API key will be removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          useSettings.getState().removeEndpoint(existing!.id);
          router.back();
        },
      },
    ]);

  const visibleModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    return q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  }, [models, modelFilter]);

  const keyPlaceholder = type === 'ollama' ? 'Optional' : type === 'openai' ? 'sk-… (optional for local servers)' : 'Required';

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: existing ? 'Edit endpoint' : 'Add endpoint',
          headerRight: () => (
            <Pressable onPress={save} hitSlop={10}>
              <Text style={{ color: colors.link, fontSize: 17, fontWeight: '600' }}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!existing && (
          <>
            <Label>Quick start</Label>
            <View style={styles.chips}>
              {PRESETS.map((p) => (
                <Chip key={p.name} label={p.name} selected={p.name === name} onPress={() => applyPreset(p)} />
              ))}
            </View>
          </>
        )}

        <Label>Name</Label>
        <Input value={name} onChangeText={setName} placeholder="My endpoint" autoCapitalize="words" />

        <Label>API format</Label>
        <View style={styles.chips}>
          {TYPES.map((t) => (
            <Chip key={t} label={PROVIDER_LABELS[t]} selected={type === t} onPress={() => setType(t)} />
          ))}
        </View>

        <Label>Base URL</Label>
        <Input
          value={baseUrl}
          onChangeText={setBaseUrl}
          placeholder={type === 'openai' ? 'https://api.example.com/v1' : 'https://…'}
          keyboardType="url"
        />
        {(type === 'ollama' || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            On a phone, use your computer&apos;s LAN IP instead of localhost, and start Ollama with OLLAMA_HOST=0.0.0.0.
          </Text>
        )}

        {altUrls.map((url, i) => (
          <View key={i} style={[styles.addRow, { marginTop: 8 }]}>
            <Input
              value={url}
              onChangeText={(text) => setAltUrls(altUrls.map((u, j) => (j === i ? text : u)))}
              placeholder="Alternative URL, e.g. http://203.0.113.5:11434"
              keyboardType="url"
              style={{ flex: 1 }}
            />
            <Pressable onPress={() => setAltUrls(altUrls.filter((_, j) => j !== i))} hitSlop={8} style={styles.removeUrl}>
              <Feather name="x" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))}
        <Pressable onPress={() => setAltUrls([...altUrls, ''])} hitSlop={6} style={styles.addUrl}>
          <Feather name="plus" size={16} color={colors.link} />
          <Text style={{ color: colors.link, fontSize: 15, fontWeight: '500' }}>Add alternative URL</Text>
        </Pressable>
        {altUrls.length > 0 && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            Other addresses for the same server, such as its LAN IP at home and a public IP or domain for when
            you&apos;re out. Clanker checks them all and uses whichever answers first.
          </Text>
        )}

        <Label>API key</Label>
        <View>
          <Input
            value={apiKey}
            onChangeText={setApiKey}
            placeholder={keyPlaceholder}
            secureTextEntry={!showKey}
            style={{ paddingRight: 44 }}
          />
          <Pressable onPress={() => setShowKey(!showKey)} hitSlop={8} style={styles.eye}>
            <Feather name={showKey ? 'eye-off' : 'eye'} size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        <View style={styles.modelsHeader}>
          <Label>Models ({models.length})</Label>
          <Pressable onPress={fetchModels} disabled={!!busy} hitSlop={8} style={styles.inlineButton}>
            {busy === 'fetch' ? (
              <ActivityIndicator size="small" color={colors.link} />
            ) : (
              <Feather name="download-cloud" size={16} color={colors.link} />
            )}
            <Text style={{ color: colors.link, fontSize: 15, fontWeight: '500' }}>Fetch models</Text>
          </Pressable>
        </View>

        <View style={styles.addRow}>
          <Input
            value={newModel}
            onChangeText={setNewModel}
            placeholder="Add model name manually"
            onSubmitEditing={addModel}
            returnKeyType="done"
            style={{ flex: 1 }}
          />
          <Pressable onPress={addModel} style={[styles.addButton, { backgroundColor: colors.sendBg }]}>
            <Feather name="plus" size={20} color={colors.sendFg} />
          </Pressable>
        </View>

        {models.length > 0 && (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            Tap a model to edit its effort levels, lowest first, or leave them empty to hide the effort control. Tap its
            context budget to set how much history to keep, such as 128K or 1M; empty uses 75% of the reported window, or
            32K when none is reported.
          </Text>
        )}

        {models.length > 10 && (
          <Input value={modelFilter} onChangeText={setModelFilter} placeholder="Filter models" style={{ marginTop: 8 }} />
        )}

        {models.length > 0 && (
          <View style={[styles.modelList, { backgroundColor: colors.surface }]}>
            {visibleModels.slice(0, 200).map((m, i) => (
              <Pressable
                key={m}
                onPress={() => setEditing({ model: m, field: 'effort', text: (efforts[m] ?? []).join(', ') })}
                style={[styles.modelRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.modelName, { color: colors.text }]}>
                    {m}
                  </Text>
                  {editing?.model === m && editing.field === 'effort' ? (
                    <Input
                      autoFocus
                      value={editing.text}
                      onChangeText={(text) => setEditing({ ...editing, text })}
                      onSubmitEditing={commitEdit}
                      onBlur={commitEdit}
                      placeholder="low, medium, high"
                      returnKeyType="done"
                      style={[styles.effortInput, { backgroundColor: colors.background }]}
                    />
                  ) : (
                    <Text numberOfLines={1} style={[styles.effortLevels, { color: colors.textTertiary }]}>
                      {efforts[m]?.length ? `Effort: ${efforts[m].join(' · ')}` : 'No effort control'}
                    </Text>
                  )}
                  {editing?.model === m && editing.field === 'budget' ? (
                    <Input
                      autoFocus
                      value={editing.text}
                      onChangeText={(text) => setEditing({ ...editing, text })}
                      onSubmitEditing={commitEdit}
                      onBlur={commitEdit}
                      placeholder="128K, 1M… (empty for auto)"
                      returnKeyType="done"
                      style={[styles.effortInput, { backgroundColor: colors.background }]}
                    />
                  ) : (
                    <Pressable
                      onPress={() => {
                        // Show the short form only when it reads back as the same number.
                        const short = budgets[m] ? formatTokens(budgets[m]) : '';
                        const text = !short || parseTokens(short) === budgets[m] ? short : String(budgets[m]);
                        setEditing({ model: m, field: 'budget', text });
                      }}
                      hitSlop={4}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <Text numberOfLines={1} style={[styles.effortLevels, { color: colors.textTertiary }]}>
                        Context budget: {formatTokens(resolveBudget({ baseUrl, contexts, budgets }, m))}
                        {budgets[m] ? '' : ' (auto)'}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <Pressable onPress={() => setModels(models.filter((x) => x !== m))} hitSlop={8}>
                  <Feather name="x" size={16} color={colors.textTertiary} />
                </Pressable>
              </Pressable>
            ))}
            {visibleModels.length > 200 && (
              <Text style={[styles.hint, { color: colors.textTertiary, padding: 12 }]}>
                {visibleModels.length - 200} more. Use the filter to find them.
              </Text>
            )}
          </View>
        )}
        {models.length > 10 && (
          <Pressable
            onPress={() =>
              Alert.alert('Remove all models?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove all', style: 'destructive', onPress: () => setModels([]) },
              ])
            }
            hitSlop={6}
            style={{ alignSelf: 'flex-end', marginTop: 8 }}
          >
            <Text style={{ color: colors.textTertiary, fontSize: 14 }}>Remove all</Text>
          </Pressable>
        )}

        <Disclosure title="Advanced" initiallyOpen={!!headersText.trim()}>
          {type === 'openai' && (
            <>
              <Label>Effort parameter</Label>
              <View style={styles.chips}>
                {EFFORT_PARAMS.map((p) => (
                  <Chip key={p.value} label={p.label} selected={effortParam === p.value} onPress={() => setEffortParam(p.value)} />
                ))}
              </View>
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {effortParam === 'chat_template_kwargs'
                  ? 'Sent as chat_template_kwargs: levels "off" and "on" set enable_thinking, any other level sets reasoning_effort (gpt-oss).'
                  : 'How the server takes the effort level. Detected when you fetch models.'}
              </Text>
            </>
          )}

          <Label>Extra headers</Label>
          <Input
            value={headersText}
            onChangeText={setHeadersText}
            placeholder={'Header-Name: value\nOne per line (optional)'}
            multiline
            style={{ minHeight: 70, textAlignVertical: 'top', fontFamily: fonts.mono, fontSize: 14 }}
          />
        </Disclosure>

        {/* Slides along when the advanced settings above open or close. */}
        <Animated.View layout={LinearTransition.duration(220)}>
          <Pressable
            onPress={testConnection}
            disabled={!!busy}
            style={({ pressed }) => [styles.button, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
          >
            {busy === 'test' ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Feather name="zap" size={16} color={colors.text} />
            )}
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>Test connection</Text>
          </Pressable>

          {status && (
            <View style={[styles.status, { backgroundColor: status.ok ? colors.surface : colors.dangerBg }]}>
              <Feather
                name={status.ok ? 'check-circle' : 'alert-circle'}
                size={16}
                color={status.ok ? colors.text : colors.danger}
              />
              <Text selectable style={{ flex: 1, color: status.ok ? colors.text : colors.danger, fontSize: 14, lineHeight: 20 }}>
                {status.text}
              </Text>
            </View>
          )}

          {existing && (
            <Pressable onPress={remove} style={({ pressed }) => [styles.button, styles.delete, pressed && { opacity: 0.6 }]}>
              <Feather name="trash-2" size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '500' }}>Delete endpoint</Text>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eye: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  modelsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  inlineButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addUrl: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, marginHorizontal: 4 },
  removeUrl: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  addButton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modelList: { borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  modelName: { fontSize: 15, fontFamily: fonts.mono },
  effortLevels: { fontSize: 13, marginTop: 3 },
  effortInput: { marginTop: 8, paddingVertical: 8, fontSize: 14 },
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
