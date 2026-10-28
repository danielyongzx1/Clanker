import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

type Props = {
  title: string;
  onMenu: () => void;
  onTitle: () => void;
  onNewChat?: () => void;
};

export function ChatHeader({ title, onMenu, onTitle, onNewChat }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const circle = [styles.circle, { backgroundColor: colors.chrome, borderColor: colors.chromeBorder }];

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: colors.background }]}>
      <Pressable
        onPress={onMenu}
        hitSlop={6}
        style={({ pressed }) => [circle, pressed && { opacity: 0.6 }]}
        accessibilityLabel="Open sidebar"
      >
        {/* ChatGPT's two-bar menu glyph */}
        <View style={{ width: 20 }}>
          <View style={[styles.bar, { width: 20, backgroundColor: colors.text }]} />
          <View style={[styles.bar, { width: 13, backgroundColor: colors.text, marginTop: 5 }]} />
        </View>
      </Pressable>

      {/* Styled like ChatGPT's Chat/Work toggle; the highlighted segment is the active model. */}
      <View style={styles.center}>
        <Pressable
          onPress={onTitle}
          accessibilityLabel="Choose model"
          style={({ pressed }) => [
            styles.track,
            { backgroundColor: colors.segmentTrack },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={[styles.thumb, { backgroundColor: colors.segmentThumb }]}>
            <Text numberOfLines={1} style={[styles.titleText, { color: colors.text }]}>
              {title}
            </Text>
          </View>
          <View style={styles.chevron}>
            <Feather name="chevron-down" size={18} color={colors.textSecondary} />
          </View>
        </Pressable>
      </View>

      <Pressable
        onPress={onNewChat}
        disabled={!onNewChat}
        hitSlop={6}
        style={({ pressed }) => [circle, !onNewChat && { opacity: 0 }, pressed && { opacity: 0.6 }]}
        accessibilityLabel="New chat"
      >
        <Feather name="edit" size={19} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8, gap: 10 },
  circle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: { height: 2, borderRadius: 1 },
  center: { flex: 1, alignItems: 'center' },
  track: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 23, padding: 4, maxWidth: '100%' },
  thumb: { height: 38, borderRadius: 19, paddingHorizontal: 18, justifyContent: 'center', flexShrink: 1 },
  chevron: { paddingLeft: 8, paddingRight: 10 },
  titleText: { fontSize: 16, fontWeight: '500' },
});
