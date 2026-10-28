import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { View, type TextStyle, type ViewStyle } from 'react-native';
import { Renderer, useMarkdown, type MarkedStyles } from 'react-native-marked';
import { fonts, useTheme, type Colors } from '@/lib/theme';
import { CodeBlock } from './CodeBlock';
import { MarkdownTable } from './MarkdownTable';

class ChatRenderer extends Renderer {
  code(text: string, language?: string, _container?: ViewStyle, _text?: TextStyle): ReactNode {
    return <CodeBlock key={this.getKey()} code={text} language={language} />;
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

function MarkdownInner({ value }: { value: string }) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => markdownStyles(colors), [colors]);
  const theme = useMemo(
    () => ({ colors: { text: colors.text, link: colors.link, code: colors.codeBg, border: colors.border } }),
    [colors]
  );
  const renderer = useMemo(() => new ChatRenderer(), []);
  const elements = useMarkdown(value, { colorScheme: scheme, styles, theme, renderer });
  return (
    <View>
      {elements.map((element, i) => (
        <Fragment key={i}>{element}</Fragment>
      ))}
    </View>
  );
}

export const Markdown = memo(MarkdownInner);
