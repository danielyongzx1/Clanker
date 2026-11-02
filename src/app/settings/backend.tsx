import Feather from '@expo/vector-icons/Feather';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Disclosure, Input, Label, Row, Section } from '@/components/Form';
import { QrScanner } from '@/components/QrScanner';
import { bridgeAddresses } from '@/lib/remote/addresses';
import { RemoteAdapter } from '@/lib/remote/client';
import { pairingFromParams, parsePairingLink, type Pairing } from '@/lib/remote/pairing';
import { groupByProvider, groupLabel, isModelHidden, modelGroup, modelInGroup, type RemoteBackend } from '@/lib/remote/types';
import { apiKeys } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { useBackends } from '@/store/backends';

const KIND_LABELS: Record<RemoteBackend['kind'], string> = { hermes: 'Hermes', harness: 'DeepSeek Harness' };

const STEPS = [
  {
    title: 'Install the bridge plugin',
    text: 'On the device running the agent, install hermes-clanker-bridge from Hermes’s Plugins, or dsh-clanker-bridge from DeepSeek Harness’s Plugins. Both are on github.com/danielyongzx1.',
  },
  {
    title: 'Configure the agent',
    text: 'Hermes: turn on its API server (API_SERVER_ENABLED and API_SERVER_KEY in its .env), then restart the gateway. Harness needs no setup.',
  },
  {
    title: 'Connect this phone',
    text: 'Scan the QR code on the plugin’s page in the agent’s app, or enter the host’s LAN or VPN address and the bridge token below. Use HTTPS over the internet; upstream credentials stay on the host.',
  },
];

/** Adds or edits a remote backend: a Hermes or DeepSeek Harness agent reached through its bridge. */
export default function BackendScreen() {
  const { colors } = useTheme();
  // `pair` carries a clanker://pair link's parameters when the phone's camera opened one.
  const { id, pair } = useLocalSearchParams<{ id?: string; pair?: string }>();
  const existing = useBackends((s) => s.remotes.find((b) => b.id === id));

  const [name, setName] = useState(existing?.name ?? '');
  const [url, setUrl] = useState(existing?.baseUrl ?? '');
  const [altUrls, setAltUrls] = useState<string[]>(existing?.altBaseUrls ?? []);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [models, setModels] = useState<string[]>(existing?.models ?? []);
  const [model, setModel] = useState(existing?.model ?? '');
  const [hidden, setHidden] = useState<string[]>(existing?.hiddenModels ?? []);
  const [hiddenProviders, setHiddenProviders] = useState<string[]>(existing?.hiddenProviders ?? []);
  // Providers whose models are listed; the one with the model for new chats starts open.
  const [openProviders, setOpenProviders] = useState<string[]>(existing?.model ? [modelGroup(existing.model)] : []);
  const [modelFilter, setModelFilter] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  // From a pairing code, so the bridge that answers must be the one the code was made for.
  const [pairedBridge, setPairedBridge] = useState('');

  // Keyed on the id: the backend is re-saved whenever its model list refreshes, which mustn't
  // overwrite a token being edited.
  const existingId = existing?.id;
  useEffect(() => {
    // A token scanned in the meantime wins.
    if (existingId) void apiKeys.get(`bridge_${existingId}`).then((key) => key && setToken((t) => t || key));
  }, [existingId]);

  /**
   * Reaches the bridge, and saves the backend once it answers when `save` is set. A scanned code
   * passes its fields in, as the form's state hasn't caught up with them yet.
   */
  const connect = async (save: boolean, fields = { url, altUrls, token, bridgeId: pairedBridge }) => {
    setBusy(save ? 'save' : 'test');
    setStatus(null);
    try {
      let parsed: URL;
      try {
        parsed = new URL(fields.url.trim());
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
        baseUrl: fields.url.trim().replace(/\/+$/, ''),
        altBaseUrls: fields.altUrls.map((value) => value.trim()).filter(Boolean),
        bridgeId: existing?.bridgeId || fields.bridgeId,
        models: [],
        model,
      };
      bridgeAddresses(draft);
      const info = await new RemoteAdapter(draft, fields.token.trim()).info();
      if (!info.models.length) throw new Error('The backend has no available models. Configure its model provider on the host first.');
      const chosen = info.models.includes(model)
        ? model
        : (info.models.find((m) => !isModelHidden(m, hidden, hiddenProviders)) ?? info.models[0]);
      setModels(info.models);
      setModel(chosen);
      setOpenProviders((open) => (open.includes(modelGroup(chosen)) ? open : [...open, modelGroup(chosen)]));
      if (save) {
        // Adding a bridge that's already saved updates that backend, so its chats carry on.
        const previous = existing ?? useBackends.getState().remotes.find((b) => b.bridgeId === info.bridgeId);
        const keepHidden = existing ? hidden : [...new Set([...(previous?.hiddenModels ?? []), ...hidden])];
        const keepHiddenProviders = existing
          ? hiddenProviders
          : [...new Set([...(previous?.hiddenProviders ?? []), ...hiddenProviders])];
        const backend: RemoteBackend = {
          ...draft,
          id: previous?.id ?? `remote_${info.bridgeId}`,
          name: draft.name || previous?.name || KIND_LABELS[info.kind],
          kind: info.kind,
          bridgeId: info.bridgeId,
          models: info.models,
          model: chosen,
          modelOptions: info.modelOptions,
          modelSwitching: info.modelSwitching,
          efforts: previous?.efforts,
          // The model for new chats is never hidden.
          hiddenModels: keepHidden.filter((m) => m !== chosen && info.models.includes(m)),
          // A hidden provider still shows the model for new chats, so it stays hidden around it.
          hiddenProviders: keepHiddenProviders.filter((p) => info.models.some((m) => modelGroup(m) === p)),
        };
        await apiKeys.set(`bridge_${backend.id}`, fields.token.trim());
        useBackends.getState().save(backend);
        close();
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

  /** Fills the form from a pairing code and tests it, so Save is all that's left. */
  const applyPairing = (pairing: Pairing) => {
    if (existing?.bridgeId && existing.bridgeId !== pairing.bridgeId) {
      setStatus({ ok: false, text: 'This code is for a different bridge. Add it as a new backend instead.' });
      return;
    }
    const saved = existing ?? useBackends.getState().remotes.find((b) => b.bridgeId === pairing.bridgeId);
    // Addresses known before, such as a VPN route, stay on as alternatives.
    const earlier = existing || !saved ? [url, ...altUrls] : [saved.baseUrl, ...(saved.altBaseUrls ?? [])];
    const fields = {
      url: pairing.urls[0],
      altUrls: [...new Set([...pairing.urls.slice(1), ...earlier.map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean)])].filter(
        (u) => u !== pairing.urls[0]
      ),
      token: pairing.token,
      bridgeId: pairing.bridgeId,
    };
    setUrl(fields.url);
    setAltUrls(fields.altUrls);
    setToken(fields.token);
    setPairedBridge(pairing.bridgeId);
    if (!name.trim()) setName(saved?.name ?? pairing.name);
    void connect(false, fields);
  };

  const opened = useRef(false);
  useEffect(() => {
    if (!pair || opened.current) return;
    opened.current = true;
    let pairing: Pairing | null = null;
    try {
      pairing = pairingFromParams(JSON.parse(pair));
    } catch {}
    if (pairing) applyPairing(pairing);
    else setStatus({ ok: false, text: 'That link isn’t a complete Clanker pairing code. Scan the code on the host’s pairing page.' });
    // Runs once, for the link the screen was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair]);

  const remove = () =>
    Alert.alert('Remove backend?', 'Chats and remote files remain. Adding the same bridge again reconnects its chats.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          useBackends.getState().remove(existing!.id);
          close();
        },
      },
    ]);

  // Stable, so tapping a row re-renders only that row rather than the whole list.
  const toggleHidden = useCallback(
    (m: string) => setHidden((h) => (h.includes(m) ? h.filter((x) => x !== m) : [...h, m])),
    []
  );
  const selectModel = useCallback((m: string) => {
    setModel(m);
    setHidden((h) => h.filter((x) => x !== m));
  }, []);
  const toggleProviderHidden = useCallback(
    (p: string) => setHiddenProviders((h) => (h.includes(p) ? h.filter((x) => x !== p) : [...h, p])),
    []
  );
  const toggleProviderOpen = useCallback(
    (p: string) => setOpenProviders((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p])),
    []
  );

  const searching = !!modelFilter.trim();
  const groups = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    return groupByProvider(models)
      .map((g) => ({ ...g, total: g.models.length, models: q ? g.models.filter((m) => m.toLowerCase().includes(q)) : g.models }))
      .filter((g) => g.models.length);
  }, [models, modelFilter]);
  // One provider, or a search, lists everything there is to see.
  const collapsible = !searching && groups.length > 1;

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

        <Pressable
          onPress={() => setScanning(true)}
          disabled={!!busy}
          style={({ pressed }) => [styles.button, styles.scan, { backgroundColor: colors.sendBg }, pressed && { opacity: 0.7 }]}
        >
          <Feather name="camera" size={16} color={colors.sendFg} />
          <Text style={{ color: colors.sendFg, fontSize: 16, fontWeight: '600' }}>Scan QR code</Text>
        </Pressable>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {existing
            ? 'Reconnect by scanning the code on the bridge’s pairing page. It fills in the current address and token.'
            : 'Scan the code on the bridge’s pairing page to fill in the address and token, or enter them below.'}
        </Text>

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
              {groups.map((g) => (
                <ProviderGroup
                  key={g.provider}
                  provider={g.provider}
                  models={g.models}
                  total={g.total}
                  open={!collapsible || openProviders.includes(g.provider)}
                  collapsible={collapsible}
                  hidden={hiddenProviders.includes(g.provider)}
                  selectedModel={model}
                  hiddenModels={hidden}
                  onToggleOpen={toggleProviderOpen}
                  onToggleHidden={toggleProviderHidden}
                  onSelectModel={selectModel}
                  onToggleModelHidden={toggleHidden}
                />
              ))}
              {!groups.length && (
                <Section inset={16} style={{ marginBottom: 0 }}>
                  <Row title="No models match" />
                </Section>
              )}
              <Text style={[styles.hint, { color: colors.textTertiary, marginBottom: 20 }]}>
                Tap a model to start new chats with it, or its eye to hide it from the model picker. A provider&apos;s eye
                hides all of its models. From the chat title, a chat can switch to another of these models.
              </Text>
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
      <QrScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        hint="Point the camera at the QR code on the bridge’s pairing page."
        onScan={(data) => {
          const pairing = parsePairingLink(data);
          if (pairing) applyPairing(pairing);
          return !!pairing;
        }}
      />
    </KeyboardAvoidingView>
  );
}

/** Listed per provider; past this many rows a provider asks for a search instead. */
const MAX_ROWS = 200;

/**
 * A provider's models under a heading: tap the heading to show or hide its models here, or its eye
 * to keep the whole provider out of the model picker.
 */
const ProviderGroup = memo(function ProviderGroup({
  provider,
  models,
  total,
  open,
  collapsible,
  hidden,
  selectedModel,
  hiddenModels,
  onToggleOpen,
  onToggleHidden,
  onSelectModel,
  onToggleModelHidden,
}: {
  provider: string;
  /** The provider's models that match the search. */
  models: string[];
  total: number;
  open: boolean;
  collapsible: boolean;
  hidden: boolean;
  selectedModel: string;
  hiddenModels: string[];
  onToggleOpen: (provider: string) => void;
  onToggleHidden: (provider: string) => void;
  onSelectModel: (model: string) => void;
  onToggleModelHidden: (model: string) => void;
}) {
  const { colors } = useTheme();
  const label = groupLabel(provider);
  const shownCount = models.length === total ? `${total}` : `${models.length} of ${total}`;
  return (
    <View style={{ marginBottom: open ? 0 : 4 }}>
      <View style={styles.groupHeader}>
        <Pressable
          onPress={() => onToggleOpen(provider)}
          disabled={!collapsible}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${shownCount} models${hidden ? ', hidden' : ''}`}
          accessibilityState={collapsible ? { expanded: open } : undefined}
          style={({ pressed }) => [styles.groupTitle, pressed && { opacity: 0.6 }]}
        >
          {collapsible && (
            <Feather
              name="chevron-right"
              size={15}
              color={colors.textTertiary}
              style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
            />
          )}
          <Text numberOfLines={1} style={[styles.groupName, { color: hidden ? colors.textTertiary : colors.textSecondary }]}>
            {label}
          </Text>
          <Text style={{ color: colors.textTertiary, fontSize: 13 }}>{shownCount}</Text>
        </Pressable>
        <Pressable
          onPress={() => onToggleHidden(provider)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={hidden ? `Show ${label} models` : `Hide ${label} models`}
          style={styles.groupEye}
        >
          <Feather name={hidden ? 'eye-off' : 'eye'} size={18} color={colors.textTertiary} />
        </Pressable>
      </View>
      {open && (
        <>
          <Section inset={16} style={{ marginBottom: models.length > MAX_ROWS ? 0 : 16 }}>
            {models.slice(0, MAX_ROWS).map((m) => (
              <ModelRow
                key={m}
                model={m}
                title={provider ? modelInGroup(m) : m}
                selected={selectedModel === m}
                hidden={hidden || hiddenModels.includes(m)}
                // The provider's eye speaks for all of its models while it hides them.
                canHide={!hidden}
                onSelect={onSelectModel}
                onToggleHidden={onToggleModelHidden}
              />
            ))}
          </Section>
          {models.length > MAX_ROWS && (
            <Text style={[styles.hint, { color: colors.textTertiary, marginBottom: 16 }]}>
              {models.length - MAX_ROWS} more. Search to find them.
            </Text>
          )}
        </>
      )}
    </View>
  );
});

/** A model in the list: tap to start new chats with it, or its eye to hide it from the model picker. */
const ModelRow = memo(function ModelRow({
  model,
  title,
  selected,
  hidden,
  canHide,
  onSelect,
  onToggleHidden,
}: {
  model: string;
  title: string;
  selected: boolean;
  hidden: boolean;
  canHide: boolean;
  onSelect: (model: string) => void;
  onToggleHidden: (model: string) => void;
}) {
  const { colors } = useTheme();
  // The model for new chats is always shown.
  const hideable = canHide && !selected;
  return (
    <Row
      title={title}
      muted={hidden && !selected}
      selected={selected}
      onPress={() => onSelect(model)}
      trailing={
        !hideable
          ? undefined
          : () => (
              <Pressable
                onPress={() => onToggleHidden(model)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={hidden ? `Show ${model}` : `Hide ${model}`}
              >
                <Feather name={hidden ? 'eye-off' : 'eye'} size={18} color={colors.textTertiary} />
              </Pressable>
            )
      }
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityActions={hideable ? [{ name: 'toggleHidden', label: hidden ? 'Show in model list' : 'Hide from model list' }] : undefined}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'toggleHidden' && onToggleHidden(model)}
    />
  );
});

// Opened from a pairing link, the screen may have nothing under it to go back to.
const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

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
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 8, paddingHorizontal: 4 },
  groupTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  groupName: { flexShrink: 1, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  groupEye: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  delete: { borderWidth: 0, marginTop: 16 },
  scan: { borderWidth: 0, marginTop: 20 },
});
