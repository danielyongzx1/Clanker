import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Input, Label, Row, Section, ToggleRow } from '@/components/Form';
import { apiKeys } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { entryOn, WEB_TOOLS } from '@/lib/tools/catalog';
import { SEARCH_PROVIDERS, searchKeyId, searchWeb } from '@/lib/tools/web';
import { useSettings, type SearchProvider } from '@/store/settings';

const PROVIDERS = Object.keys(SEARCH_PROVIDERS) as SearchProvider[];

const KEY_USE = { none: 'No key needed', optional: 'Key optional', required: 'Needs an API key' };

/** Where the web_search tool sends queries. Changes save as they are made. */
export default function SearchScreen() {
  const { colors } = useTheme();
  const search = useSettings((s) => s.search);
  const setSearch = useSettings((s) => s.setSearch);
  const webOn = useSettings((s) => s.tools && s.web);
  const disabled = useSettings((s) => s.disabledTools);
  const setToolsEnabled = useSettings((s) => s.setToolsEnabled);
  const { provider } = search;
  const info = SEARCH_PROVIDERS[provider];

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const test = useRef<AbortController | null>(null);

  useEffect(() => {
    if (info.key === 'none') return;
    let current = true;
    apiKeys.get(searchKeyId(provider)).then((k) => current && k && setApiKey(k));
    return () => {
      current = false;
    };
  }, [provider, info.key]);

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
      const { results } = await searchWeb('weather today', 3, controller.signal, { config: search, fallback: false });
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
        <Section title="Tools" footer={webOn ? undefined : 'Web access is off, so models get neither tool.'} inset={16}>
          {WEB_TOOLS.map((entry) => (
            <ToggleRow
              key={entry.title}
              title={entry.title}
              detail={entry.detail}
              value={entryOn(entry, disabled)}
              onValueChange={(on) => setToolsEnabled(entry.names, on)}
              disabled={!webOn}
            />
          ))}
        </Section>

        <Section title="Provider" footer={info.hint} inset={16} style={{ marginBottom: 4 }}>
          {PROVIDERS.map((p) => (
            <Row
              key={p}
              title={SEARCH_PROVIDERS[p].label}
              detail={p === 'searxng' ? 'Self-hosted' : KEY_USE[SEARCH_PROVIDERS[p].key]}
              selected={provider === p}
              onPress={() => choose(p)}
              accessibilityRole="radio"
              accessibilityState={{ selected: provider === p }}
            />
          ))}
        </Section>

        {info.key !== 'none' && (
          <>
            <Label>API key</Label>
            <View>
              <Input
                value={apiKey}
                onChangeText={changeKey}
                placeholder={`${info.label} API key${info.key === 'optional' ? ' (optional)' : ''}`}
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
          When a search fails, the other providers you have set up are tried, then Firecrawl and DuckDuckGo. Pages are
          fetched directly from this phone; only those that need JavaScript or turn away direct requests are loaded through
          Firecrawl. Files the model downloads are saved to the workspace under downloads/.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 60 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 6, marginHorizontal: 4 },
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
