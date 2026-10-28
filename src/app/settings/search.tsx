import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chip, Input, Label } from '@/components/Form';
import { apiKeys } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { SEARCH_PROVIDERS, searchKeyId, searchWeb } from '@/lib/tools/web';
import { useSettings, type SearchProvider } from '@/store/settings';

const PROVIDERS = Object.keys(SEARCH_PROVIDERS) as SearchProvider[];

/** Where the web_search tool sends queries. Changes save as they are made. */
export default function SearchScreen() {
  const { colors } = useTheme();
  const search = useSettings((s) => s.search);
  const setSearch = useSettings((s) => s.setSearch);
  const { provider } = search;
  const info = SEARCH_PROVIDERS[provider];

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!info.needsKey) return;
    let current = true;
    apiKeys.get(searchKeyId(provider)).then((k) => current && k && setApiKey(k));
    return () => {
      current = false;
    };
  }, [provider, info.needsKey]);

  useEffect(() => () => test.current?.abort(), []);

  const choose = (next: SearchProvider) => {
    if (next === provider) return;
    test.current?.abort();
    setApiKey('');
    setStatus(null);
    setBusy(false);
    setSearch({ ...search, provider: next });
  };

  const changeKey = (key: string) => {
    setApiKey(key);
    apiKeys.set(searchKeyId(provider), key.trim());
  };

  const runTest = async () => {
    test.current?.abort();
    const controller = (test.current = new AbortController());
    setBusy(true);
    setStatus(null);
    try {
      const results = await searchWeb('weather today', 3, controller.signal, search);
      setStatus(
        results.length
          ? { ok: true, text: `Search works. Top result: ${results[0].title}\n${results[0].url}` }
          : { ok: false, text: `${info.label} answered, but with no results.` }
      );
    } catch (e) {
      if (!controller.signal.aborted) setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (test.current === controller) setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Label>Search provider</Label>
        <View style={styles.chips}>
          {PROVIDERS.map((p) => (
            <Chip key={p} label={SEARCH_PROVIDERS[p].label} selected={provider === p} onPress={() => choose(p)} />
          ))}
        </View>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{info.hint}</Text>

        {info.needsKey && (
          <>
            <Label>API key</Label>
            <View>
              <Input
                value={apiKey}
                onChangeText={changeKey}
                placeholder={`${info.label} API key`}
                secureTextEntry={!showKey}
                style={{ paddingRight: 44 }}
              />
              <Pressable onPress={() => setShowKey(!showKey)} hitSlop={8} style={styles.eye}>
                <Feather name={showKey ? 'eye-off' : 'eye'} size={18} color={colors.textTertiary} />
              </Pressable>
            </View>
          </>
        )}

        {provider === 'searxng' && (
          <>
            <Label>Instance URL</Label>
            <Input
              value={search.url ?? ''}
              onChangeText={(url) => setSearch({ ...search, url })}
              placeholder="http://192.168.1.10:8080"
              keyboardType="url"
            />
          </>
        )}

        <Pressable
          onPress={runTest}
          disabled={busy}
          style={({ pressed }) => [styles.button, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
        >
          {busy ? <ActivityIndicator size="small" color={colors.text} /> : <Feather name="zap" size={16} color={colors.text} />}
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>Test search</Text>
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

        <Text style={[styles.hint, { color: colors.textTertiary, marginTop: 20 }]}>
          Pages are fetched directly from this phone whatever the provider, and files the model downloads are saved to the
          workspace under downloads/.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 60 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 6, marginHorizontal: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eye: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
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
});
