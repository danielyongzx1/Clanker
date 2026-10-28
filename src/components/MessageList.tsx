import Feather from '@expo/vector-icons/Feather';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useTheme } from '@/lib/theme';
import type { Message } from '@/store/chats';
import { MessageBubble } from './MessageBubble';

type Props = {
  messages: Message[];
  onRegenerate: (messageId: string) => void;
  // Heights of the header and composer floating over the list, so content rests clear of them.
  topInset: number;
  bottomInset: number;
};

export function MessageList({ messages, onRegenerate, topInset, bottomInset }: Props) {
  const { colors } = useTheme();
  const listRef = useRef<FlatList<Message>>(null);
  const [showJump, setShowJump] = useState(false);
  // Inverted list: index 0 is the newest message and offset 0 is the bottom.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const lastAssistantId = data.find((m) => m.role === 'assistant')?.id;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowJump(e.nativeEvent.contentOffset.y > 300);
  }, []);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble message={item} isLast={item.id === lastAssistantId} onRegenerate={onRegenerate} />
        )}
        // Inverted flips the content, so its top padding shows at the bottom and vice versa.
        contentContainerStyle={{ paddingTop: 12 + bottomInset, paddingBottom: 12 + topInset }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
      />
      {showJump && (
        <Pressable
          onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
          style={[styles.jump, { bottom: 12 + bottomInset, backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <Feather name="arrow-down" size={18} color={colors.text} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  jump: {
    position: 'absolute',
    alignSelf: 'center',
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
