import { memo, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { HorizontalScroll } from './HorizontalScroll';

// Narrowest a column gets before the table runs past the screen and scrolls sideways.
const MIN_COLUMN = 150;
// The assistant row's side padding.
const GUTTER = 32;

type Props = { header: ReactNode[][]; rows: ReactNode[][][] };

function MarkdownTableInner({ header, rows }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // Fills the width when the columns fit; otherwise each keeps a readable width and the table scrolls.
  const columnWidth = Math.max(MIN_COLUMN, Math.floor((width - GUTTER) / Math.max(header.length, 1)));

  const row = (cells: ReactNode[][], key: string, isHeader: boolean) => (
    <View
      key={key}
      style={[
        styles.row,
        { borderTopColor: colors.border },
        isHeader ? { backgroundColor: colors.codeHeader, borderTopWidth: 0 } : null,
      ]}
    >
      {cells.map((cell, i) => (
        <View
          key={i}
          style={[styles.cell, { width: columnWidth, borderLeftColor: colors.border }, i === 0 && styles.first]}
        >
          {cell}
        </View>
      ))}
    </View>
  );

  return (
    <HorizontalScroll style={styles.scroll}>
      <View style={[styles.table, { borderColor: colors.border }]}>
        {row(header, 'h', true)}
        {rows.map((cells, i) => row(cells, `r${i}`, false))}
      </View>
    </HorizontalScroll>
  );
}

export const MarkdownTable = memo(MarkdownTableInner);

const styles = StyleSheet.create({
  scroll: { marginVertical: 8 },
  table: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  row: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  cell: { padding: 8, borderLeftWidth: StyleSheet.hairlineWidth },
  first: { borderLeftWidth: 0 },
});
