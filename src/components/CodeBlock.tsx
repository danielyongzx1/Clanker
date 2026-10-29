import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import type { ElementContent, Root } from 'hast';
import { common, createLowlight } from 'lowlight';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '@/lib/theme';
import { HorizontalScroll } from './HorizontalScroll';

const lowlight = createLowlight(common);

// highlight.js scopes → colors (GitHub light / One Dark).
const palettes = {
  light: {
    base: '#24292E',
    keyword: '#D73A49',
    built_in: '#E36209',
    type: '#6F42C1',
    literal: '#005CC5',
    number: '#005CC5',
    string: '#032F62',
    regexp: '#032F62',
    comment: '#6A737D',
    title: '#6F42C1',
    params: '#24292E',
    attr: '#005CC5',
    attribute: '#005CC5',
    variable: '#E36209',
    tag: '#22863A',
    name: '#22863A',
    meta: '#6A737D',
    symbol: '#005CC5',
    property: '#005CC5',
    section: '#005CC5',
    addition: '#22863A',
    deletion: '#B31D28',
  },
  dark: {
    base: '#ABB2BF',
    keyword: '#C678DD',
    built_in: '#E6C07B',
    type: '#E6C07B',
    literal: '#56B6C2',
    number: '#D19A66',
    string: '#98C379',
    regexp: '#98C379',
    comment: '#7F848E',
    title: '#61AFEF',
    params: '#ABB2BF',
    attr: '#D19A66',
    attribute: '#D19A66',
    variable: '#E06C75',
    tag: '#E06C75',
    name: '#E06C75',
    meta: '#61AFEF',
    symbol: '#61AFEF',
    property: '#E06C75',
    section: '#E06C75',
    addition: '#98C379',
    deletion: '#E06C75',
  },
};

type Palette = (typeof palettes)['light'];

function colorFor(classNames: unknown, palette: Palette): string | undefined {
  if (!Array.isArray(classNames)) return undefined;
  for (const cls of classNames) {
    // "hljs-title" and compound scopes like "hljs-title function_" → "title".
    const key = String(cls).replace(/^hljs-/, '').replace(/_+$/, '') as keyof Palette;
    if (key in palette) return palette[key];
  }
  return undefined;
}

function renderNodes(nodes: ElementContent[], palette: Palette, keyPrefix = ''): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    if (node.type === 'text') return node.value;
    if (node.type !== 'element') return null;
    const color = colorFor(node.properties?.className, palette);
    const italic = Array.isArray(node.properties?.className) && node.properties.className.includes('hljs-comment');
    return (
      <Text key={key} style={[color ? { color } : null, italic ? { fontStyle: 'italic' } : null]}>
        {renderNodes(node.children, palette, key + '.')}
      </Text>
    );
  });
}

// Past these sizes code stays plain: guessing its language runs every grammar over it, and
// highlighting much more than that stalls the app for long enough to notice.
const AUTO_MAX = 2000;
const HIGHLIGHT_MAX = 20_000;

function highlight(code: string, language?: string): Root | null {
  try {
    if (code.length > HIGHLIGHT_MAX) return null;
    if (language && lowlight.registered(language)) return lowlight.highlight(language, code);
    if (!language && code.length <= AUTO_MAX) return lowlight.highlightAuto(code);
  } catch {}
  return null;
}

const LIVE_LINES = 20;
// Nor more characters than this, for code with very long lines.
const LIVE_CHARS = 2000;

/** The last `LIVE_LINES` lines of `text`, found from the end so long text costs no more. */
function tail(text: string) {
  let at = text.length;
  for (let i = 0; i < LIVE_LINES && at > 0; i++) at = text.lastIndexOf('\n', at - 1);
  at = Math.max(at, text.length - LIVE_CHARS);
  return at <= 0 ? text : '…' + text.slice(at);
}

const CATCH_UP_LINES = 10;

/** Where the last whole run of `CATCH_UP_LINES` lines in `text` ends. */
function catchUpPoint(text: string) {
  let cut = 0;
  let lines = 0;
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) {
    if (++lines % CATCH_UP_LINES === 0) cut = at + 1;
  }
  return cut;
}

/**
 * Highlighting and laying out all the code again on every update of code that's still streaming
 * in drops frames. `live` code (a tool call being written) shows only its end, unhighlighted.
 * `streaming` code (in an answer) shows whole, highlighted every `CATCH_UP_LINES` lines with the
 * newest lines plain until then. Either is highlighted whole once done.
 */
function CodeBlockInner({
  code,
  language,
  live = false,
  streaming = false,
}: {
  code: string;
  language?: string;
  live?: boolean;
  streaming?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const palette = palettes[scheme];
  const [copied, setCopied] = useState(false);
  const lang = language?.trim().split(/\s+/)[0]?.toLowerCase() || undefined;
  const text = code.replace(/\n$/, '');

  // The part that's highlighted. A guessed language could change as more code comes in, so code
  // without a known one waits until it's done.
  const settled = live
    ? ''
    : !streaming
      ? text
      : lang && lowlight.registered(lang)
        ? text.slice(0, catchUpPoint(text))
        : '';
  const highlighted = useMemo(() => {
    const tree = settled ? highlight(settled, lang) : null;
    return tree ? renderNodes(tree.children as ElementContent[], palette) : settled;
  }, [settled, lang, palette]);

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.codeBg, borderColor: colors.border }]}>
      <View style={[styles.header, { backgroundColor: colors.codeHeader }]}>
        <Text style={[styles.lang, { color: colors.textSecondary }]}>{lang ?? 'code'}</Text>
        <Pressable onPress={copy} hitSlop={8} style={styles.copy}>
          <Feather name={copied ? 'check' : 'copy'} size={13} color={colors.textSecondary} />
          <Text style={[styles.copyText, { color: colors.textSecondary }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <HorizontalScroll contentContainerStyle={styles.body}>
        <Text selectable style={[styles.code, { color: palette.base }]}>
          {live ? tail(text) : highlighted}
          {!live && text.slice(settled.length)}
        </Text>
      </HorizontalScroll>
    </View>
  );
}

export const CodeBlock = memo(CodeBlockInner);

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  lang: { fontSize: 12 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyText: { fontSize: 12 },
  body: { padding: 14 },
  code: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20 },
});
