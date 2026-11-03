import Feather from '@expo/vector-icons/Feather';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';
import { useChats, type Message } from '@/store/chats';
import { MessageBubble } from './MessageBubble';

const NO_MESSAGES: Message[] = [];

type Props = {
  conversationId: string;
  onRegenerate?: (messageId: string) => void;
  // Heights of the header and composer floating over the list, so content rests clear of them.
  // The composer's is a shared value: it follows the box's expand animation on the UI thread.
  topInset: number;
  bottomInset: SharedValue<number>;
};

export function MessageList({ conversationId, onRegenerate, topInset, bottomInset }: Props) {
  const { colors } = useTheme();
  const messages = useChats((s) => s.conversations[conversationId]?.messages ?? NO_MESSAGES);
  const listRef = useRef<FlatList<Message>>(null);
  const [showJump, setShowJump] = useState(false);
  // Inverted list: index 0 is the newest message and offset 0 is the bottom.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const lastAssistantId = data.find((m) => m.role === 'assistant')?.id;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowJump(e.nativeEvent.contentOffset.y > 300);
  }, []);
  const spacerStyle = useAnimatedStyle(() => ({ height: bottomInset.value }));
  const jumpStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -bottomInset.value }] }));

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble conversationId={conversationId} message={item} isLast={item.id === lastAssistantId} onRegenerate={onRegenerate} />
        )}
        // Inverted flips the content, so its top padding and header show at the bottom and vice
        // versa. The header is the composer's room, sized without re-rendering the list.
        ListHeaderComponent={<Animated.View style={spacerStyle} />}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 12 + topInset }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        // Selectable text takes focus when tapped or held, and on Android the list then scrolls
        // the focused text into view, which in an inverted list lands somewhere else entirely.
        scrollsChildToFocus={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
      />
      {showJump && (
        <Animated.View style={[styles.jumpSlot, jumpStyle]}>
          <Pressable
            onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
            style={[styles.jump, { backgroundColor: colors.background, borderColor: colors.border }]}
          >
            <Feather name="arrow-down" size={18} color={colors.text} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  jumpSlot: { position: 'absolute', alignSelf: 'center', bottom: 12 },
  jump: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
