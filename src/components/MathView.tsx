import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { texToSvg } from '@/lib/math';
import { fonts, useTheme } from '@/lib/theme';
import { HorizontalScroll } from './HorizontalScroll';

// The reply text's size; one em of the formula.
const EM = 16;

/** A formula set on its own line, centered, scrolling sideways when wider than the reply. */
export const MathBlock = memo(function MathBlock({ tex }: { tex: string }) {
  const { colors } = useTheme();
  const svg = texToSvg(tex, true);
  if (!svg) {
    return (
      <Text selectable style={[styles.source, { color: colors.textSecondary }]}>
        {tex}
      </Text>
    );
  }
  return (
    <HorizontalScroll style={styles.block} contentContainerStyle={styles.blockContent}>
      <SvgXml xml={svg.xml} width={svg.width * EM} height={svg.height * EM} color={colors.text} />
    </HorizontalScroll>
  );
});

/** A formula in a line of text, sitting on its baseline. */
export const InlineMath = memo(function InlineMath({ tex }: { tex: string }) {
  const { colors } = useTheme();
  const svg = texToSvg(tex, false);
  if (!svg) return <Text style={[styles.source, { color: colors.textSecondary }]}>{tex}</Text>;
  return (
    // Views in text rest on the baseline; the part of the formula below it is shifted down to match.
    <View style={{ transform: [{ translateY: svg.depth * EM }] }}>
      <SvgXml xml={svg.xml} width={svg.width * EM} height={svg.height * EM} color={colors.text} />
    </View>
  );
});

const styles = StyleSheet.create({
  block: { marginVertical: 8 },
  blockContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 2 },
  source: { fontFamily: fonts.mono, fontSize: 14, lineHeight: 22 },
});
