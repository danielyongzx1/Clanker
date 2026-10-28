import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { faviconUrl, siteName, type Site, type SourceEntry } from '@/lib/sources';
import { useTheme } from '@/lib/theme';

// Chips shown before "N more"; a lone extra chip is shown rather than hidden behind "1 more".
const FIRST_CHIPS = 3;

const ENTER = { duration: 260, easing: Easing.bezier(0.23, 1, 0.32, 1) };
const EXIT = { duration: 180, easing: Easing.bezier(0.3, 0, 0.8, 0.6) };
// A drag down past this, or a fling, closes the sheet.
const DISMISS_DRAG = 120;

const open = (url: string) => Linking.openURL(url).catch(() => {});

/** A site's icon on a small white disc, so dark icons stay visible in dark mode; a globe when it has none. */
export function Favicon({ host, size = 18 }: { host: string; size?: number }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const disc = { width: size, height: size, borderRadius: size / 2 };
  if (failed) return <Feather name="globe" size={size - 2} color={colors.textSecondary} style={{ width: size, textAlign: 'center' }} />;
  return (
    <View style={[styles.disc, disc]}>
      <Image
        source={{ uri: faviconUrl(host) }}
        style={{ width: size * 0.72, height: size * 0.72 }}
        contentFit="contain"
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

/** "Searched 28 websites" over a chip per site; tapping the line hides the chips, "N more" shows the rest. */
function SiteChipsInner({ sites, searched }: { sites: Site[]; searched: boolean }) {
  const { colors } = useTheme();
  const [shown, setShown] = useState(true);
  const [all, setAll] = useState(false);
  if (!sites.length) return null;
  const visible = all || sites.length <= FIRST_CHIPS + 1 ? sites : sites.slice(0, FIRST_CHIPS);
  const label = `${searched ? 'Searched' : 'Read'} ${sites.length} ${sites.length === 1 ? 'website' : 'websites'}`;

  return (
    <View style={styles.siteBlock}>
      <Pressable
        onPress={() => setShown(!shown)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${shown ? 'hide' : 'show'} sites`}
        style={({ pressed }) => [styles.siteHeader, pressed && { opacity: 0.6 }]}
      >
        <Favicon host={sites[0].host} size={20} />
        <Text style={[styles.siteLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Feather
          name="chevron-down"
          size={14}
          color={colors.textSecondary}
          style={{ transform: [{ rotate: shown ? '180deg' : '0deg' }] }}
        />
      </Pressable>
      {shown && (
        <View style={styles.chips}>
          {visible.map((site) => (
            <Pressable
              key={site.host}
              onPress={() => open(site.url)}
              accessibilityRole="link"
              accessibilityLabel={site.host}
              style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.surfaceHover : colors.surface }]}
            >
              <Favicon host={site.host} />
              <Text numberOfLines={1} style={[styles.chipText, { color: colors.text }]}>
                {site.host}
              </Text>
            </Pressable>
          ))}
          {visible.length < sites.length && (
            <Pressable
              onPress={() => setAll(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.surfaceHover : colors.surface }]}
            >
              <Text style={[styles.chipText, { color: colors.text }]}>{sites.length - visible.length} more</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export const SiteChips = memo(SiteChipsInner);

/** The reply's "Sources" button: a stack of site icons that opens the list of sources. */
export function SourcesButton({ sources }: { sources: SourceEntry[] }) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const hosts = [...new Set(sources.map((s) => s.host))].slice(0, 3);
  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Sources, ${sources.length}`}
        style={({ pressed }) => [styles.sourcesButton, pressed && { opacity: 0.6 }]}
      >
        <View style={styles.stack}>
          {hosts.map((host, i) => (
            <View
              key={host}
              style={[styles.stacked, { borderColor: colors.background, marginLeft: i ? -7 : 0, zIndex: hosts.length - i }]}
            >
              <Favicon host={host} size={18} />
            </View>
          ))}
        </View>
        <Text style={[styles.sourcesLabel, { color: colors.textSecondary }]}>Sources</Text>
      </Pressable>
      <SourcesSheet sources={sources} visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

function SourceRow({ source }: { source: SourceEntry }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => open(source.url)}
      accessibilityRole="link"
      style={({ pressed }) => [styles.row, { borderBottomColor: colors.border }, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.rowSite}>
        <Favicon host={source.host} size={16} />
        <Text numberOfLines={1} style={[styles.rowSiteName, { color: colors.textSecondary }]}>
          {siteName(source.host)}
        </Text>
      </View>
      <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text }]}>
        {source.title || source.url}
      </Text>
      {!!source.snippet && (
        <Text numberOfLines={2} style={[styles.rowSnippet, { color: colors.textSecondary }]}>
          {source.snippet}
        </Text>
      )}
      {!!source.date && <Text style={[styles.rowDate, { color: colors.textTertiary }]}>{source.date}</Text>}
    </Pressable>
  );
}

/** Bottom sheet listing a reply's sources; drag the top down or tap outside to close. */
function SourcesSheet({ sources, visible, onClose }: { sources: SourceEntry[]; visible: boolean; onClose: () => void }) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Stay mounted through the exit animation.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      drag.set(0);
      progress.set(withTiming(1, ENTER));
    } else if (mounted) {
      progress.set(
        withTiming(0, EXIT, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(setMounted, false);
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      drag.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DRAG || e.velocityY > 800) scheduleOnRN(onClose);
      else drag.set(withTiming(0, ENTER));
    });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * height * 0.9 + drag.value }],
  }));

  if (!mounted) return null;
  const background = scheme === 'dark' ? colors.surface : colors.background;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdropStyle]}>
          <Pressable style={styles.fill} onPress={visible ? onClose : undefined} accessibilityLabel="Close sources" />
        </Animated.View>
        <Animated.View
          pointerEvents={visible ? 'auto' : 'none'}
          style={[styles.sheet, { backgroundColor: background, maxHeight: height * 0.88, paddingBottom: insets.bottom }, sheetStyle]}
        >
          <GestureDetector gesture={pan}>
            <View>
              <View style={[styles.handle, { backgroundColor: colors.textTertiary }]} />
              <Text style={[styles.sheetTitle, { color: colors.textSecondary, borderBottomColor: colors.border }]}>
                Sources
              </Text>
            </View>
          </GestureDetector>
          <FlatList
            data={sources}
            keyExtractor={(s) => s.url}
            renderItem={({ item }) => <SourceRow source={item} />}
            contentContainerStyle={styles.list}
          />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  disc: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  siteBlock: { marginTop: 4, marginBottom: 6, gap: 8 },
  siteHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  siteLabel: { fontSize: 15, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '100%',
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 13,
    paddingVertical: 6,
  },
  chipText: { fontSize: 14, flexShrink: 1 },
  sourcesButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 6 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  stacked: { borderWidth: 2, borderRadius: 999 },
  sourcesLabel: { fontSize: 14, fontWeight: '500' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 14, opacity: 0.5 },
  sheetTitle: { fontSize: 14, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  list: { paddingHorizontal: 20 },
  row: { paddingVertical: 16, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  rowSite: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowSiteName: { fontSize: 14, flexShrink: 1 },
  rowTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  rowSnippet: { fontSize: 14, lineHeight: 20 },
  rowDate: { fontSize: 13, marginTop: 2 },
});
