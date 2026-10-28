import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { attachmentUri } from '@/lib/attachments';
import type { FilePart, ImagePart, ToolPart } from '@/lib/providers';
import { useTheme } from '@/lib/theme';
import { messageText, type Message } from '@/store/chats';
import { Markdown } from './Markdown';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ToolCall } from './ToolCall';

type Props = {
  message: Message;
  isLast: boolean;
  onRegenerate: (messageId: string) => void;
};

function Files({ files, align }: { files: FilePart[]; align: 'flex-end' | 'flex-start' }) {
  const { colors } = useTheme();
  if (!files.length) return null;
  return (
    <View style={[styles.images, { justifyContent: align }]}>
      {files.map((f, i) => (
        <View
          key={`${f.file ?? f.name}-${i}`}
          style={[styles.fileChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Feather name="paperclip" size={15} color={colors.textSecondary} />
          <Text numberOfLines={1} style={[styles.fileName, { color: colors.text }]}>
            {f.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

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

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; part: ToolPart }
  | { kind: 'thought'; text: string; ms?: number };

/** Runs of text merged into one markdown block, with thoughts and tool calls between them, in reply order. */
function segmentsOf(message: Message): Segment[] {
  // Replies saved before thoughts were content parts keep theirs in one block at the top.
  const out: Segment[] = message.reasoning ? [{ kind: 'thought', text: message.reasoning, ms: message.thoughtMs }] : [];
  for (const part of message.content) {
    const last = out[out.length - 1];
    if (part.type === 'text') {
      if (last?.kind === 'text') last.text += part.text;
      else out.push({ kind: 'text', text: part.text });
    } else if (part.type === 'tool') out.push({ kind: 'tool', part });
    else if (part.type === 'thought') out.push({ kind: 'thought', text: part.text, ms: part.ms });
  }
  return out;
}

/** One stretch of the model's thinking: a "Thought for Ns" pill that shows or hides the text. */
function Thoughts({ text, ms, live }: { text: string; ms?: number; live: boolean }) {
  const { colors } = useTheme();
  // Expanded while it streams; a tap pins the choice either way.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? live;
  return (
    <>
      <ThinkingIndicator
        thinking={live}
        expanded={open}
        toggleable
        thoughtMs={ms}
        onToggle={() => setOpenOverride(!open)}
      />
      {open && (
        <ScrollView style={styles.thoughts} nestedScrollEnabled>
          <View style={[styles.thoughtsInner, { borderLeftColor: colors.border }]}>
            <Text selectable style={[styles.thoughtsText, { color: colors.textSecondary }]}>
              {text}
            </Text>
          </View>
        </ScrollView>
      )}
    </>
  );
}

function MessageBubbleInner({ message, isLast, onRegenerate }: Props) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const images = message.content.filter((p): p is ImagePart => p.type === 'image');
  const files = message.content.filter((p): p is FilePart => p.type === 'file');

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
        <Files files={files} align="flex-end" />
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
  const segments = segmentsOf(message);
  const lastSeg = segments[segments.length - 1];
  // A bare pulsing pill while the model is working with nothing streaming yet: before its first
  // token, and while it works out its next step after a round of tool calls. Streamed thoughts
  // pulse in their own pill instead.
  const waiting = streaming && (!lastSeg || (lastSeg.kind === 'tool' && lastSeg.part.status !== 'running'));

  return (
    <View style={styles.assistantRow}>
      {segments.map((seg, i) =>
        seg.kind === 'tool' ? (
          <ToolCall key={seg.part.id} part={seg.part} />
        ) : seg.kind === 'thought' ? (
          <Thoughts key={`r${i}`} text={seg.text} ms={seg.ms} live={streaming && seg === lastSeg} />
        ) : (
          !!seg.text.trim() && <Markdown key={`t${i}`} value={seg.text} />
        )
      )}
      {waiting && <ThinkingIndicator thinking expanded={false} toggleable={false} onToggle={() => {}} />}

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
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '82%',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  fileName: { fontSize: 15, flexShrink: 1 },
  assistantRow: { paddingHorizontal: 16, marginVertical: 6, gap: 2 },
  thoughts: { maxHeight: 260, marginVertical: 4 },
  thoughtsInner: { borderLeftWidth: 3, paddingLeft: 12, paddingRight: 4 },
  thoughtsText: { fontSize: 14, lineHeight: 21 },
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
