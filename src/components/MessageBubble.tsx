import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { attachmentUri } from '@/lib/attachments';
import type { ImagePart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { messageText, type Message } from '@/store/chats';
import { Markdown } from './Markdown';
import { TypingIndicator } from './TypingIndicator';

type Props = {
  message: Message;
  isLast: boolean;
  onRegenerate: (messageId: string) => void;
};

function Images({ images, align }: { images: ImagePart[]; align: 'flex-end' | 'flex-start' }) {
  if (!images.length) return null;
  const size = images.length === 1 ? 220 : 120;
  return (
    <View style={[styles.images, { justifyContent: align }]}>
      {images.map((img) => (
        <Image
          key={img.file}
          source={{ uri: attachmentUri(img.file) }}
          style={{
            width: size,
            height: img.width && img.height && images.length === 1 ? Math.min(size * (img.height / img.width), 320) : size,
            borderRadius: 16,
          }}
          contentFit="cover"
        />
      ))}
    </View>
  );
}

function MessageBubbleInner({ message, isLast, onRegenerate }: Props) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const images = message.content.filter((p): p is ImagePart => p.type === 'image');

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <Images images={images} align="flex-end" />
        {!!text && (
          <Pressable onLongPress={copy} style={[styles.userBubble, { backgroundColor: colors.userBubble }]}>
            <Text selectable style={[styles.userText, { color: colors.text }]}>
              {text}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  const streaming = message.status === 'streaming';
  return (
    <View style={styles.assistantRow}>
      {streaming && !text ? <TypingIndicator /> : !!text && <Markdown value={text} />}

      {message.status === 'error' && (
        <View style={[styles.error, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}>
          <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>{message.error}</Text>
          <Pressable
            onPress={() => onRegenerate(message.id)}
            style={[styles.retry, { borderColor: colors.danger }]}
            hitSlop={6}
          >
            <Feather name="rotate-ccw" size={14} color={colors.danger} />
            <Text style={{ color: colors.danger, fontWeight: '500' }}>Retry</Text>
          </Pressable>
        </View>
      )}

      {message.status === 'done' && (
        <View style={styles.actions}>
          {!!text && (
            <Pressable onPress={copy} hitSlop={8} style={styles.action}>
              <Feather name={copied ? 'check' : 'copy'} size={16} color={colors.textSecondary} />
            </Pressable>
          )}
          {isLast && (
            <Pressable onPress={() => onRegenerate(message.id)} hitSlop={8} style={styles.action}>
              <Feather name="refresh-cw" size={16} color={colors.textSecondary} />
            </Pressable>
          )}
          {!!message.model && (
            <Text numberOfLines={1} style={[styles.model, { color: colors.textTertiary }]}>
              {message.model}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleInner);

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingHorizontal: 16, marginVertical: 10, gap: 6 },
  userBubble: { maxWidth: '82%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  userText: { fontSize: 16, lineHeight: 23 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '82%' },
  assistantRow: { paddingHorizontal: 16, marginVertical: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, marginLeft: -6 },
  action: { padding: 6 },
  model: { fontSize: 12, marginLeft: 6, flexShrink: 1 },
  error: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginTop: 4 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
