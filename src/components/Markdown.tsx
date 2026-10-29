import { cloneElement, Fragment, isValidElement, memo, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { MarkedLexer, Renderer, useMarkdown, type MarkedStyles } from 'react-native-marked';
import { fonts, useTheme, type Colors } from '@/lib/theme';
import { Chart, parseChart } from './Chart';
import { CodeBlock } from './CodeBlock';
import { ChatImage, ImageCards, parseImages } from './ImageCards';
import { MarkdownTable } from './MarkdownTable';

/** Shown in place of a chart or image block whose JSON is still streaming in. */
function Pending({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pending, { backgroundColor: colors.surface }]}>
      <Text style={{ color: colors.textTertiary, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

class ChatRenderer extends Renderer {
  /** True while the text is still streaming, so an unfinished visual block is expected rather than broken. */
  constructor(private live: boolean) {
    super();
  }

  private keys = 0;

  /**
   * The base renderer's keys keep counting up across parses, so every re-render (each streamed
   * token) gave every element a new key and remounted it, reloading images and charts. Counting
   * from zero on each parse keys elements by position, which earlier content doesn't change.
   */
  reset() {
    this.keys = 0;
  }

  getKey(): string {
    return `md-${this.keys++}`;
  }

  code(raw: string, language?: string, _container?: ViewStyle, _text?: TextStyle): ReactNode {
    const lang = language?.trim().split(/\s+/)[0]?.toLowerCase();
    // While the closing fence streams in, the block's text briefly ends in "\n`" or "\n``": a code
    // block would grow a line and lose it, and a chart or image block would turn invalid and drop
    // back to its placeholder for a token, remounting its images.
    const text = this.live ? raw.replace(/\n`{1,2}$/, '') : raw;
    // Charts and cards take the block's text rather than the parsed object, so their memo holds
    // while text after them streams in.
    if (lang === 'chart') {
      if (parseChart(text)) return <Chart key={this.getKey()} source={text} />;
      if (this.live) return <Pending key={this.getKey()} label="Drawing chart…" />;
    } else if (lang === 'images') {
      if (parseImages(text)) return <ImageCards key={this.getKey()} source={text} />;
      if (this.live) return <Pending key={this.getKey()} label="Loading images…" />;
    }
    return <CodeBlock key={this.getKey()} code={text} language={language} streaming={this.live} />;
  }

  image(uri: string, alt?: string, _style?: ImageStyle, title?: string): ReactNode {
    return <ChatImage key={this.getKey()} src={uri} alt={alt} title={title} />;
  }

  table(header: ReactNode[][], rows: ReactNode[][][]): ReactNode {
    return <MarkdownTable key={this.getKey()} header={header} rows={rows} />;
  }
}

function markdownStyles(colors: Colors): MarkedStyles {
  const heading: TextStyle = { color: colors.text, fontWeight: '600', borderBottomWidth: 0, paddingBottom: 0 };
  return {
    text: { color: colors.text, fontSize: 16, lineHeight: 26 },
    strong: { color: colors.text, fontSize: 16, lineHeight: 26, fontWeight: '600' },
    em: { color: colors.text, fontSize: 16, lineHeight: 26 },
    strikethrough: { color: colors.text, fontSize: 16, lineHeight: 26 },
    paragraph: { paddingVertical: 6 },
    link: { color: colors.link, fontStyle: 'normal', fontSize: 16, lineHeight: 26 },
    h1: { ...heading, fontSize: 24, lineHeight: 32, marginTop: 14, marginBottom: 6 },
    h2: { ...heading, fontSize: 21, lineHeight: 28, marginTop: 14, marginBottom: 6 },
    h3: { ...heading, fontSize: 18, lineHeight: 26, marginTop: 12, marginBottom: 4 },
    h4: { ...heading, fontSize: 17, lineHeight: 24, marginTop: 10, marginBottom: 4 },
    h5: { ...heading, fontSize: 16, lineHeight: 24 },
    h6: { ...heading, fontSize: 16, lineHeight: 24 },
    codespan: {
      fontFamily: fonts.mono,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.inlineCode,
    },
    blockquote: { borderLeftColor: colors.border, borderLeftWidth: 3, paddingLeft: 12, opacity: 1 },
    hr: { borderBottomColor: colors.border, borderBottomWidth: 1, marginVertical: 16 },
    li: { color: colors.text, fontSize: 16, lineHeight: 26 },
    list: { marginVertical: 2 },
  };
}

// A link reference definition ("[1]: https://…") serves links anywhere in the text, so text with
// one is parsed whole rather than block by block.
const REFERENCE = /^ {0,3}\[[^\]]+\]:/m;

type Split = { text: string; blocks: string[] };

/**
 * The top-level blocks of `text` (each with the blank lines after it), reusing `prev`, the split of
 * text it continues: of that, only the last block (which more text may still extend) is lexed
 * again, so streamed text costs as much as its last block rather than all of it.
 */
function splitBlocks(text: string, prev: Split | null): string[] {
  if (REFERENCE.test(text)) return [text];
  const settled = prev && text.startsWith(prev.text) ? prev.blocks.slice(0, -1) : [];
  let start = settled.reduce((n, b) => n + b.length, 0);
  const rest = text.slice(start);
  const tokens = MarkedLexer(rest, { gfm: true });
  // A block is settled once another one starts after it; the last stays open.
  const lastBlock = tokens.findLastIndex((t) => t.type !== 'space');
  let at = 0;
  let block = '';
  for (let i = 0; i < lastBlock; i++) {
    const raw = tokens[i].raw;
    if (!rest.startsWith(raw, at)) break;
    block += raw;
    at += raw.length;
    if (tokens[i + 1].type !== 'space' && block.trim()) {
      settled.push(block);
      start += block.length;
      block = '';
    }
  }
  return [...settled, text.slice(start)];
}

/** One top-level block, parsed again only when its own text changes. */
const MarkdownBlock = memo(function MarkdownBlock({ value, live }: { value: string; live: boolean }) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => markdownStyles(colors), [colors]);
  const theme = useMemo(
    () => ({ colors: { text: colors.text, link: colors.link, code: colors.codeBg, border: colors.border } }),
    [colors]
  );
  const renderer = useMemo(() => new ChatRenderer(live), [live]);
  // useMarkdown parses during this render whenever the text changed.
  renderer.reset();
  const elements = useMarkdown(value, { colorScheme: scheme, styles, theme, renderer });
  return (
    <>
      {/* Blocks are keyed by position: the renderer keys a block after its children, so the block
          still streaming in would otherwise get a new key, and remount, with every inline token. */}
      {elements.map((element, i) =>
        isValidElement(element) ? cloneElement(element, { key: i }) : <Fragment key={i}>{element}</Fragment>
      )}
    </>
  );
});

function MarkdownInner({ value, live = false }: { value: string; live?: boolean }) {
  const [split, setSplit] = useState<Split>(() => ({ text: value, blocks: splitBlocks(value, null) }));
  let blocks = split.blocks;
  if (split.text !== value) {
    blocks = splitBlocks(value, split);
    setSplit({ text: value, blocks });
  }
  return (
    <View>
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} value={block} live={live && i === blocks.length - 1} />
      ))}
    </View>
  );
}

export const Markdown = memo(MarkdownInner);

const styles = StyleSheet.create({
  pending: { height: 140, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginVertical: 10 },
});
