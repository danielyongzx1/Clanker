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

  return (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <Pressable onPress={onMenu} hitSlop={10} style={styles.icon} accessibilityLabel="Open sidebar">
        {/* ChatGPT's two-bar menu glyph */}
        <View style={{ width: 20 }}>
          <View style={[styles.bar, { width: 20, backgroundColor: colors.text }]} />
          <View style={[styles.bar, { width: 13, backgroundColor: colors.text, marginTop: 5 }]} />
        </View>
      </Pressable>

      <Pressable onPress={onTitle} hitSlop={6} style={({ pressed }) => [styles.title, pressed && { opacity: 0.6 }]}>
        <Text numberOfLines={1} style={[styles.titleText, { color: colors.text }]}>
          {title}
        </Text>
        <Feather name="chevron-right" size={16} color={colors.textTertiary} />
      </Pressable>

      <Pressable
        onPress={onNewChat}
        disabled={!onNewChat}
        hitSlop={10}
        style={[styles.icon, !onNewChat && { opacity: 0 }]}
        accessibilityLabel="New chat"
      >
        <Feather name="edit" size={20} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  icon: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 2, borderRadius: 1 },
  title: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8 },
  titleText: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
});
