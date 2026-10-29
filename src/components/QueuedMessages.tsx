import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';
import type { QueuedMessage } from '@/store/chats';
import { composerMargin } from './Composer';

const ROW = 40;
// How far the card tucks in under the composer, so it reads as hanging off the box's top.
const TUCK = 18;
// Narrower than the composer on each side, as a tab sitting on it.
const INSET = 12;
const MAX_ROWS = 4;

type Props = {
  messages: QueuedMessage[];
  /** Whether a reply is running: sending one now steers it rather than starting a turn. */
  streaming: boolean;
  /** The composer's expansion, so the card keeps to its width. */
  progress: SharedValue<number>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSendNow: (id: string) => void;
};

function summary(message: QueuedMessage) {
  const line = message.text.trim().split('\n')[0];
  if (line) return line;
  const n = message.attachments.length;
  return `${n} attachment${n === 1 ? '' : 's'}`;
}

/** Messages sent while a reply runs, stacked above the composer until they go out. */
export function QueuedMessages({ messages, streaming, progress, onEdit, onDelete, onSendNow }: Props) {
  const { colors } = useTheme();
  const cardStyle = useAnimatedStyle(() => ({ marginHorizontal: composerMargin(progress.value) + INSET }));

  const press = (fn: (id: string) => void, id: string) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn(id);
  };

  return (
    <Animated.View
      style={[styles.card, { backgroundColor: colors.chrome, borderColor: colors.chromeBorder }, cardStyle]}
    >
      <ScrollView
        style={{ maxHeight: ROW * MAX_ROWS + 0.5 * ROW }}
        scrollEnabled={messages.length > MAX_ROWS}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m) => (
          <Animated.View key={m.id} entering={FadeIn.duration(160)} style={styles.row}>
            <Feather
              name={m.steer ? 'corner-down-right' : 'message-circle'}
              size={16}
              color={m.steer ? colors.accentText : colors.textSecondary}
            />
            <Text numberOfLines={1} style={[styles.text, { color: colors.text }]}>
              {summary(m)}
            </Text>
            {m.attachments.length > 0 && m.text.trim() !== '' && (
              <Feather name="paperclip" size={13} color={colors.textTertiary} />
            )}
            {m.steer && <Text style={[styles.tag, { color: colors.accentText }]}>Steering</Text>}
            <Action icon="edit" label="Edit queued message" onPress={press(onEdit, m.id)} />
            <Action icon="trash-2" label="Delete queued message" onPress={press(onDelete, m.id)} />
            {!m.steer && (
              <Action
                icon="arrow-up"
                label={streaming ? 'Steer the reply with this message now' : 'Send this message now'}
                onPress={press(onSendNow, m.id)}
              />
            )}
          </Animated.View>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.5 }]}
      accessibilityLabel={label}
    >
      <Feather name={icon} size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingTop: 2,
    paddingBottom: TUCK,
    marginBottom: -TUCK,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', height: ROW, paddingLeft: 14, paddingRight: 6, gap: 8 },
  text: { flex: 1, fontSize: 15 },
  tag: { fontSize: 12, fontWeight: '600' },
  action: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
